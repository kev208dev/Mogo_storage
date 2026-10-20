import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  recoverStaleJobs,
  STALE_PROCESSING_ERROR,
  type Job,
} from "@/ingestion/jobs/queue";
import { runJobs } from "@/ingestion/jobs/worker";
import { JOB_HANDLERS } from "@/ingestion/jobs/registry";
import { makeContext, resetDb, setupDb, TEST_DB_URL } from "./helpers";

const run = describe.skipIf(!TEST_DB_URL);

run("job worker time budget", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  async function enqueue(n: number, now: Date) {
    for (let i = 0; i < n; i += 1)
      await enqueueJob(db, {
        runAt: now,
        type: "generate_study_materials",
        payload: { examId: `exam-${i}` },
        dedupeKey: `test:${i}`,
        maxAttempts: 3,
      });
  }

  /** 모든 종류를 같은 가짜 처리기로 (실제 PDF·네트워크 없음) */
  const handlersFrom = (fn: (job: Job) => Promise<void>) =>
    Object.fromEntries(
      Object.keys(JOB_HANDLERS).map((type) => [type, (_: unknown, job: Job) => fn(job)]),
    ) as unknown as typeof JOB_HANDLERS;

  it("checks the deadline before every job and releases unstarted claims", async () => {
    const { ctx } = makeContext(db);
    await enqueue(5, ctx.now());
    const seen: string[] = [];
    // 첫 job 이 예산 전체보다 오래 걸린다 → 같은 batch 의 나머지 4개는 시작하지 않는다
    const slow = handlersFrom(async (job) => {
      seen.push(job.id);
      await new Promise((r) => setTimeout(r, 120));
    });
    const first = await runJobs(ctx, { timeBudgetMs: 50, batchSize: 5, handlers: slow });
    expect(first).toEqual({
      processed: 1,
      completed: 1,
      retrying: 0,
      failed: 0,
      released: 4,
      recovered: 0,
      lost: 0,
    });
    expect(seen).toHaveLength(1);

    const rows = await db.select().from(s.jobs);
    const released = rows.filter((r) => r.id !== seen[0]);
    expect(released.every((r) => r.status === "pending")).toBe(true);
    // 시작하지 않은 job 은 시도 횟수를 쓰지 않고 lock 도 남기지 않는다
    expect(
      released.every((r) => r.attempts === 0 && r.lockedBy === null && r.lockedAt === null),
    ).toBe(true);

    const fast = handlersFrom(async () => undefined);
    const second = await runJobs(ctx, { timeBudgetMs: 5_000, batchSize: 5, handlers: fast });
    expect(second).toMatchObject({ processed: 4, completed: 4, released: 0 });
    const done = await db.select().from(s.jobs).where(eq(s.jobs.status, "completed"));
    expect(done).toHaveLength(5);
  });

  it("a released retrying job keeps its earlier attempts", async () => {
    const { ctx } = makeContext(db);
    await enqueue(2, ctx.now());
    await db.update(s.jobs).set({ status: "retrying", attempts: 2 });
    const slow = handlersFrom(() => new Promise((r) => setTimeout(r, 80)));
    const result = await runJobs(ctx, { timeBudgetMs: 20, batchSize: 2, handlers: slow });
    expect(result.released).toBe(1);
    const left = (await db.select().from(s.jobs)).find((r) => r.status !== "completed")!;
    expect(left).toMatchObject({ status: "retrying", attempts: 2, lockedBy: null });
  });
});

run("job queue stale recovery and ownership", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 21, 0, minutes));

  it("멈춘 job 은 backoff 로 되살리고, 시도 횟수를 다 쓴 job 은 failed 로 닫는다 (무한 반복 없음)", async () => {
    await enqueueJob(db, {
      type: "publish_artifact",
      payload: {},
      dedupeKey: "stuck:a",
      maxAttempts: 3,
      runAt: at(0),
    });
    await enqueueJob(db, {
      type: "publish_artifact",
      payload: {},
      dedupeKey: "stuck:b",
      maxAttempts: 3,
      runAt: at(0),
    });
    // 두 job 모두 worker 가 잡은 뒤 함수가 죽었다 (processing 으로 남음)
    expect(await claimJobs(db, { limit: 10, workerId: "dead-worker", now: at(0) })).toHaveLength(2);
    // b 는 이미 마지막 시도였다
    await db.update(s.jobs).set({ attempts: 3 }).where(eq(s.jobs.dedupeKey, "stuck:b"));

    // 15분이 안 됐으면 건드리지 않는다
    expect(await recoverStaleJobs(db, 15 * 60_000, at(10))).toEqual({ retried: 0, dead: [] });

    const recovery = await recoverStaleJobs(db, 15 * 60_000, at(20));
    expect(recovery.retried).toBe(1);
    expect(recovery.dead).toHaveLength(1);
    const rows = Object.fromEntries((await db.select().from(s.jobs)).map((r) => [r.dedupeKey, r]));
    expect(rows["stuck:a"]).toMatchObject({
      status: "retrying",
      attempts: 1,
      lockedBy: null,
      lastError: STALE_PROCESSING_ERROR,
    });
    // attempts=1 → 30초 backoff (바로 다시 잡히지 않는다)
    expect(rows["stuck:a"]!.runAt.getTime()).toBe(at(20).getTime() + 30_000);
    expect(rows["stuck:b"]).toMatchObject({ status: "failed", attempts: 3, lockedBy: null });
    expect(await claimJobs(db, { limit: 10, workerId: "w", now: at(20) })).toHaveLength(0);
    expect(
      await claimJobs(db, { limit: 10, workerId: "w", now: new Date(at(20).getTime() + 30_000) }),
    ).toHaveLength(1);
    // a 가 또 멈췄다 → 두 번째 시도분 backoff(60초)로 되살린다. 이미 failed 인 b 는 그대로
    const again = await recoverStaleJobs(db, 15 * 60_000, at(90));
    expect(again).toEqual({ retried: 1, dead: [] });
    const [b] = await db.select().from(s.jobs).where(eq(s.jobs.dedupeKey, "stuck:b"));
    expect(b).toMatchObject({ status: "failed", attempts: 3 });
    const [a] = await db.select().from(s.jobs).where(eq(s.jobs.dedupeKey, "stuck:a"));
    expect(a).toMatchObject({ status: "retrying", attempts: 2 });
    expect(a!.runAt.getTime()).toBe(at(90).getTime() + 60_000);
  });

  it("stale 복구로 다른 worker 가 가져간 job 은 늦게 끝난 이전 worker 가 덮어쓰지 않는다", async () => {
    await enqueueJob(db, { type: "publish_artifact", payload: {}, dedupeKey: "own", runAt: at(0) });
    const [first] = await claimJobs(db, { limit: 1, workerId: "slow", now: at(0) });
    await recoverStaleJobs(db, 15 * 60_000, at(20));
    const [second] = await claimJobs(db, { limit: 1, workerId: "fast", now: at(30) });
    expect(second!.id).toBe(first!.id);

    // 이전 worker 의 완료·실패 기록은 무시된다
    expect(await completeJob(db, first!.id, at(31), "slow")).toBe(false);
    expect(
      await failJob(
        db,
        { ...first!, lockedBy: "slow" },
        { message: "late", retryable: false },
        at(31),
      ),
    ).toBe("lost");
    let [row] = await db.select().from(s.jobs);
    expect(row).toMatchObject({ status: "processing", lockedBy: "fast" });

    // 지금 잡고 있는 worker 의 기록만 반영된다
    expect(await completeJob(db, second!.id, at(32), "fast")).toBe(true);
    [row] = await db.select().from(s.jobs);
    expect(row).toMatchObject({ status: "completed", lockedBy: null });
  });

  it("runJobs: 시도 횟수를 다 쓴 멈춘 job 은 job_dead 로 알리고 처리 결과에 센다", async () => {
    const { ctx, setNow, logs } = makeContext(db);
    setNow(at(0));
    await enqueueJob(db, {
      type: "publish_artifact",
      payload: {},
      dedupeKey: "dead",
      maxAttempts: 1,
      runAt: at(0),
    });
    await claimJobs(db, { limit: 1, workerId: "gone", now: at(0) });
    setNow(at(30));
    const noop = Object.fromEntries(
      Object.keys(JOB_HANDLERS).map((type) => [type, async () => undefined]),
    ) as unknown as typeof JOB_HANDLERS;
    const result = await runJobs(ctx, { timeBudgetMs: 5_000, handlers: noop });
    expect(result).toMatchObject({ processed: 0, failed: 1, recovered: 0 });
    expect(logs.some((l) => l.event === "job.failed" && l.code === "STALE_PROCESSING")).toBe(true);
    // LogOpsNotifier 는 job_dead 를 job.failed 로 남긴다 (webhook 이 있으면 webhook 으로)
    expect(logs.filter((l) => l.event === "job.failed")).toHaveLength(2);
    const [row] = await db.select().from(s.jobs);
    expect(row).toMatchObject({ status: "failed", lastError: STALE_PROCESSING_ERROR });
  });
});

run("study materials storage", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  beforeEach(async () => {
    await resetDb(db);
  });

  it("mock storage that cannot write fails fast with STORAGE_NOT_CONFIGURED and creates no rows", async () => {
    const [exam] = await db
      .insert(s.exams)
      .values({ year: 2099, grade: 3, month: 9, examType: "kice_mock", organizer: "t", slug: "s" })
      .returning();
    await db.insert(s.vocabulary).values({
      examId: exam!.id,
      questionNumber: 18,
      word: "testword",
      meaning: "테스트",
    });
    const readOnlyMock = {
      name: "mock",
      getFileUrl: async () => "",
      getDownloadUrl: async () => "",
      putObject: async () => {
        throw Object.assign(
          new Error("ENOENT: no such file or directory, mkdir '/var/task/.data'"),
          {
            code: "ENOENT",
          },
        );
      },
    };
    const { ctx } = makeContext(db, { storage: readOnlyMock });
    const { generateStudyMaterials } = await import("@/ingestion/study/materials");
    const error = await generateStudyMaterials(ctx, exam!.id).catch((e) => e);
    expect(error).toMatchObject({ code: "STORAGE_NOT_CONFIGURED", retryable: false });
    expect(await db.select().from(s.studyMaterials)).toEqual([]);
  });
});
