import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { enqueueJob, type Job } from "@/ingestion/jobs/queue";
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
    expect(first).toEqual({ processed: 1, completed: 1, retrying: 0, failed: 0, released: 4 });
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
