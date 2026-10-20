import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { queueRechecks, runBackfill } from "@/ingestion/backfill";
import { enqueueJob } from "@/ingestion/jobs/queue";
import { runJobs } from "@/ingestion/jobs/worker";
import { isFetchPolicyBlocked } from "@/ingestion/sources/policy";
import {
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
 * robots·anti-bot 정책상 파일 요청이 금지된 source(KICE)의 자료는 운영 조건에서
 * 재검증 예약도, queue 에 남아 있던 검증 job 도 서버가 요청하지 않는다.
 * (자료는 테스트 context 의 fake source 로 미리 만들고, 운영 조건으로 바꿔 확인한다)
 */
describe.skipIf(!TEST_DB_URL)("fetch_file policy gate (verify · recheck)", () => {
  let db: Database;
  let kice: FakeSource;

  beforeAll(async () => {
    db = await setupDb();
    kice = await startFakeSource();
  });
  afterAll(async () => {
    await kice?.close();
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await resetDb(db);
    kice.routes.clear();
    kice.hits.length = 0;
    kice.set("/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&page=1", {
      contentType: "text/html",
      body: `<table class="board_list"><tbody><tr><td class="subject"><a href="/boardCnts/view.do?boardSeq=77">2025년 9월 모의평가 문제 및 정답</a></td><td class="date">2025-09-03</td></tr></tbody></table>`,
    });
    kice.set("/boardCnts/list.do?boardID=1500234&m=0403&s=suneung&page=2", {
      contentType: "text/html",
      body: `<p class="no_data"></p>`,
    });
    kice.set("/boardCnts/view.do?boardSeq=77", {
      contentType: "text/html",
      body: `<ul class="file_list"><li><a href="/down/77/kor.pdf">국어영역_문제지.pdf</a></li></ul>`,
    });
    kice.set("/down/77/kor.pdf", {
      contentType: "application/pdf",
      body: await makePdf(["TEST FIXTURE — NOT A REAL EXAM", "x".repeat(60)]),
    });
    await installSources(db, [testSource("kice", "kice", kice.baseUrl)]);
  });

  it("KICE 는 정책 표에서 파일 요청 금지, EBSi 직접 파일은 허용", () => {
    expect(isFetchPolicyBlocked("kice")).toBe(true);
    expect(isFetchPolicyBlocked("education_office")).toBe(true);
    expect(isFetchPolicyBlocked("ebsi")).toBe(false);
  });

  it("운영 조건에서는 오래된 KICE 자료를 재검증 예약하지 않고, 남은 검증 job 도 요청하지 않는다", async () => {
    // 테스트 context(fake source 허용)로 자료를 만든다
    const { ctx: setupCtx } = makeContext(db);
    await runBackfill(setupCtx, { fromYear: 2025, toYear: 2025, grades: [3], sourceIds: ["kice"] });
    const [artifact] = await db.select().from(s.sourceArtifacts);
    expect(artifact).toMatchObject({ sourceId: "kice", status: "ready" });
    expect(await db.select().from(s.examFiles)).toHaveLength(1);

    // 8일이 지나 재검증 대상이 됐다
    const old = new Date(setupCtx.now().getTime() - 8 * 24 * 3600_000);
    await db
      .update(s.sourceArtifacts)
      .set({ lastCheckedAt: old })
      .where(eq(s.sourceArtifacts.id, artifact!.id));
    await db.delete(s.jobs);
    kice.hits.length = 0;

    const { ctx, logs } = makeContext(db);
    ctx.allowUnverifiedSources = false; // 운영과 같은 조건
    expect(await queueRechecks(ctx)).toBe(0);
    expect(await db.select().from(s.jobs)).toHaveLength(0);

    // 정책이 바뀌기 전에 queue 에 들어간 검증 job 이 남아 있어도 요청하지 않는다
    await enqueueJob(db, {
      runAt: ctx.now(),
      type: "verify_artifact",
      payload: { artifactId: artifact!.id, recheck: true },
      dedupeKey: "left-over-verify",
    });
    const result = await runJobs(ctx, { timeBudgetMs: 5_000 });
    expect(result).toMatchObject({ processed: 1, completed: 1, failed: 0 });
    expect(kice.hits.filter((h) => h.startsWith("/down/"))).toEqual([]);
    expect(
      logs.some(
        (l) => l.event === "ingestion.skipped" && l.reason === "fetch_file is policy_blocked",
      ),
    ).toBe(true);
    // 이미 게시된 자료는 그대로 (내리지 않는다)
    const [after] = await db.select().from(s.sourceArtifacts);
    expect(after).toMatchObject({ status: "ready" });
    expect(await db.select().from(s.examFiles)).toHaveLength(1);

    // 테스트 context(fake source 허용)에서는 같은 자료를 재검증 예약한다 — gate 가 정책 표만 보는지 확인
    const { ctx: fakeCtx } = makeContext(db);
    expect(await queueRechecks(fakeCtx)).toBe(1);
  });
});
