import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { runBackfill } from "@/ingestion/backfill";
import {
  approveLiveVerification,
  loadSources,
  recordLiveFixtureEvidence,
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
    await installSources(db, [testSource("ebsi", "ebsi", fake.baseUrl)]);
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
      sourceIds: ["ebsi"],
    });
    expect(results).toEqual([]);
    expect(fake.hits).not.toContain("/f/k.pdf");
    expect(await db.select().from(s.exams)).toHaveLength(0);
    expect(
      logs.some(
        (l) =>
          l.event === "ingestion.skipped" &&
          l.reason === "source not verified against live fixtures",
      ),
    ).toBe(true);
  });

  it("enabling requires verification; approval requires live fixture evidence for the current parser", async () => {
    await expect(setSourceEnabled(db, "ebsi", true)).rejects.toThrow(/fixture/);
    await expect(approveLiveVerification(db, "ebsi", "ops@example.com")).rejects.toThrow(
      /검증 기록이 없습니다/,
    );

    await recordLiveFixtureEvidence(db, "ebsi", {
      passed: true,
      fixtureHash: "f".repeat(32),
      parserVersion: "ebsi-v0",
      at: new Date(),
    });
    await expect(approveLiveVerification(db, "ebsi", "ops@example.com")).rejects.toThrow(
      /다시 검증/,
    );

    await recordLiveFixtureEvidence(db, "ebsi", {
      passed: true,
      fixtureHash: "f".repeat(32),
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    await approveLiveVerification(db, "ebsi", "ops@example.com");
    const [row] = await db.select().from(s.examSources).where(eq(s.examSources.id, "ebsi"));
    expect(row).toMatchObject({
      verifiedAgainstLiveFixture: true,
      verifiedBy: "ops@example.com",
      verifiedParserVersion: currentParserVersion("ebsi"),
      verifiedFixtureHash: "f".repeat(32),
    });
    await setSourceEnabled(db, "ebsi", true);

    const { ctx } = productionContext();
    const { results } = await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] });
    expect(results[0]).toMatchObject({ source: "ebsi", status: "completed" });
    expect(await db.select().from(s.examFiles)).toHaveLength(1);
  });

  it("a parser version change invalidates the approval", async () => {
    await recordLiveFixtureEvidence(db, "ebsi", {
      passed: true,
      fixtureHash: "a".repeat(32),
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    await approveLiveVerification(db, "ebsi", "ops@example.com");
    expect((await loadSources(db))[0]!.liveVerified).toBe(true);
    // parser 코드가 바뀌어 버전이 올라간 상황 = 승인된 버전과 현재 버전이 다름
    await db
      .update(s.examSources)
      .set({ verifiedParserVersion: "ebsi-v0" })
      .where(eq(s.examSources.id, "ebsi"));
    expect((await loadSources(db))[0]!.liveVerified).toBe(false);
    const { ctx } = productionContext();
    expect((await runBackfill(ctx, { fromYear: 2025, toYear: 2025, grades: [2] })).results).toEqual(
      [],
    );
  });

  it("a failed live fixture validation revokes approval and stops the source", async () => {
    await recordLiveFixtureEvidence(db, "ebsi", {
      passed: true,
      fixtureHash: "a".repeat(32),
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    await approveLiveVerification(db, "ebsi", "ops@example.com");
    await recordLiveFixtureEvidence(db, "ebsi", {
      passed: false,
      fixtureHash: null,
      parserVersion: currentParserVersion("ebsi"),
      at: new Date(),
    });
    const [row] = await db.select().from(s.examSources).where(eq(s.examSources.id, "ebsi"));
    expect(row).toMatchObject({
      verifiedAgainstLiveFixture: false,
      enabled: false,
      healthStatus: "broken",
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
});
