import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { runBackfill } from "@/ingestion/backfill";
import {
  approveLiveVerification,
  loadSources,
  recordHealthCheck,
  recordLiveFixtureEvidence,
  setSourceCapability,
  setSourceEnabled,
} from "@/ingestion/pipeline/sources";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import { currentParserVersion } from "@/ingestion/sources/verification";
import {
  ebsiListingHtml,
  installSources,
  makeContext,
  makePdf,
  resetDb,
  setupDb,
  startFakeSource,
  testSource,
  TEST_DB_URL,
  type FakeSource,
} from "./helpers";

/**
 * 게이트 메커니즘은 정책 표(sources/policy.ts)에 없는 테스트 전용 source 로 검증한다 (parser 종류는 ebsi).
 * 실제 "ebsi" id 는 robots 정책상 목록 수집을 켤 수 없다 — 아래 정책 테스트 참고.
 */
const SRC = "fake_ebsi";

describe.skipIf(!TEST_DB_URL)("source verification gate (live fixture + admin approval)", () => {
  let db: Database;
  let fake: FakeSource;

  beforeAll(async () => {
    db = await setupDb();
    fake = await startFakeSource();
  });
  afterAll(async () => {
    await fake?.close();
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
    fake.routes.clear();
    const u = new URL(ebsiListingUrl(fake.baseUrl, 2, 2025));
    fake.set(u.pathname + u.search, {
      contentType: "text/html",
      body: ebsiListingHtml(fake.baseUrl, [
        {
          id: "G-1",
          title: "2025년 9월 고2 전국연합학력평가",
          subjects: [{ name: "국어", links: [{ label: "문제", path: "/f/k.pdf" }] }],
        },
      ]),
    });
    fake.set("/f/k.pdf", {
      contentType: "application/pdf",
      body: await makePdf(["TEST FIXTURE", "x".repeat(50)]),
    });
    // 운영과 같은 기본값: 기능은 모두 꺼진 상태
    await installSources(db, [
      testSource(SRC, "ebsi", fake.baseUrl, {
        capabilities: { discovery: false, artifacts: false, release_watch: false },
      }),
    ]);
  });

  const productionContext = () => {
    const made = makeContext(db);
    made.ctx.allowUnverifiedSources = false; // 운영과 같은 조건
    return made;
  };

  it("an enabled but unverified source is never ingested", async () => {
    const { ctx, logs } = productionContext();
    const [source] = await loadSources(db);
    expect(source).toMatchObject({ enabled: true, liveVerified: false });
    const { results } = await runBackfill(ctx, {
      fromYear: 2025,
      toYear: 2025,
      grades: [2],
      sourceIds: [SRC],
    });
    expect(results).toEqual([]);
    expect(fake.hits).not.toContain("/f/k.pdf");
    expect(await db.select().from(s.exams)).toHaveLength(0);
    expect(
      logs.some(
        (l) =>
          l.event === "ingestion.skipped" &&
          l.reason === "source not verified/enabled for discovery",
      ),
    ).toBe(true);
  });

  it("enabling requires verification; approval requires live fixture evidence for the current parser", async () => {
    await expect(setSourceEnabled(db, SRC, true)).rejects.toThrow(/fixture/);
    await expect(approveLiveVerification(db, SRC, "ops@example.com")).rejects.toThrow(
      /검증 기록이 없습니다/,
    );

    await recordLiveFixtureEvidence(db, SRC, {
      passed: true,
      fixtureHash: "f".repeat(32),
      parserVersion: "ebsi-v0",
      at: new Date(),
    });
    await expect(approveLiveVerification(db, SRC, "ops@example.com")).rejects.toThrow(/다시 검증/);

    await recordLiveFixtureEvidence(db, SRC, {
      passed: true,
      fixtureHash: "f".repeat(32),
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    await approveLiveVerification(db, SRC, "ops@example.com");
    const [row] = await db.select().from(s.examSources).where(eq(s.examSources.id, SRC));
    expect(row).toMatchObject({
      verifiedAgainstLiveFixture: true,
      verifiedBy: "ops@example.com",
      verifiedParserVersion: currentParserVersion("ebsi"),
      verifiedFixtureHash: "f".repeat(32),
    });
    // 승인만으로는 켤 수 없다: 최근 health check 통과가 필요
    await expect(setSourceEnabled(db, SRC, true)).rejects.toThrow(/health check/);
    await recordHealthCheck(db, SRC, {
      status: "network_error",
      checkedAt: new Date().toISOString(),
      message: "timeout",
    });
    await expect(setSourceEnabled(db, SRC, true)).rejects.toThrow(/network_error/);
    await recordHealthCheck(db, SRC, {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      message: "parsed 1 exams",
    });
    await setSourceEnabled(db, SRC, true);
    // 기능은 단계적으로: artifacts 는 discovery 뒤에만
    await expect(setSourceCapability(db, SRC, "artifacts", true)).rejects.toThrow(/discovery/);
    await setSourceCapability(db, SRC, "discovery", true);
    await setSourceCapability(db, SRC, "artifacts", true);

    const { ctx } = productionContext();
    const { results } = await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    expect(results[0]).toMatchObject({ source: SRC, status: "completed" });
    expect(await db.select().from(s.examFiles)).toHaveLength(1);
  });

  it("a parser version change invalidates the approval", async () => {
    await recordLiveFixtureEvidence(db, SRC, {
      passed: true,
      fixtureHash: "a".repeat(32),
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    await approveLiveVerification(db, SRC, "ops@example.com");
    expect((await loadSources(db))[0]!.liveVerified).toBe(true);
    // parser 코드가 바뀌어 버전이 올라간 상황 = 승인된 버전과 현재 버전이 다름
    await db
      .update(s.examSources)
      .set({ verifiedParserVersion: "ebsi-v0" })
      .where(eq(s.examSources.id, SRC));
    expect((await loadSources(db))[0]!.liveVerified).toBe(false);
    const { ctx } = productionContext();
    expect((await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] })).results).toEqual(
      [],
    );
  });

  it("a failed live fixture validation revokes approval and stops the source", async () => {
    await recordLiveFixtureEvidence(db, SRC, {
      passed: true,
      fixtureHash: "a".repeat(32),
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    await approveLiveVerification(db, SRC, "ops@example.com");
    await recordLiveFixtureEvidence(db, SRC, {
      passed: false,
      fixtureHash: null,
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    const [row] = await db.select().from(s.examSources).where(eq(s.examSources.id, SRC));
    expect(row).toMatchObject({
      verifiedAgainstLiveFixture: false,
      enabled: false,
      healthStatus: "structure_changed",
      discoveryEnabled: false,
      artifactEnabled: false,
    });
  });

  it("SOURCE_<ID>_ENABLED=true cannot bypass the gate", async () => {
    process.env.SOURCE_EBSI_ENABLED = "true";
    try {
      const [source] = await loadSources(db);
      expect(source).toMatchObject({ enabled: true, liveVerified: false });
      const { ctx } = productionContext();
      expect(
        (await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] })).results,
      ).toEqual([]);
    } finally {
      delete process.env.SOURCE_EBSI_ENABLED;
    }
  });
  it("정책: 실제 ebsi 는 모든 검증 조건을 갖춰도 목록 수집을 켤 수 없고, DB 를 직접 켜도 실행되지 않는다", async () => {
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
    await recordLiveFixtureEvidence(db, "ebsi", {
      passed: true,
      fixtureHash: "e".repeat(32),
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    await approveLiveVerification(db, "ebsi", "ops@example.com");
    await recordHealthCheck(db, "ebsi", {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      message: "ok",
    });
    await expect(setSourceEnabled(db, "ebsi", true)).rejects.toThrow(/정책상 자동 수집 금지/);
    await expect(setSourceCapability(db, "ebsi", "discovery", true)).rejects.toThrow(/정책상/);

    // 누군가 DB 를 직접 바꿔 켜 둔 상황에서도 pipeline 게이트가 막는다
    await db
      .update(s.examSources)
      .set({
        enabled: true,
        discoveryEnabled: true,
        artifactEnabled: true,
        releaseWatchEnabled: true,
      })
      .where(eq(s.examSources.id, "ebsi"));
    const { ctx } = productionContext();
    const hitsBefore = fake.hits.length;
    const { results } = await runBackfill(ctx, {
      fromYear: 2025,
      toYear: 2025,
      grades: [2],
      sourceIds: ["ebsi"],
    });
    expect(results).toEqual([]);
    expect(fake.hits.slice(hitsBefore)).toEqual([]);
    expect(await db.select().from(s.exams)).toHaveLength(0);
  });
});
