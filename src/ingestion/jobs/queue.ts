import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { jobs } from "../../db/schema";
import type { JobType } from "../constants";

export type Job = typeof jobs.$inferSelect;

export interface EnqueueInput {
  type: JobType;
  payload: Record<string, unknown>;
  /** 같은 작업을 여러 번 enqueue 해도 1건만 생긴다 */
  dedupeKey: string;
  maxAttempts?: number;
  runAt?: Date;
}

/** idempotent enqueue. 새로 만들어졌으면 true */
export async function enqueueJob(
  db: Pick<Database, "insert">,
  input: EnqueueInput,
): Promise<boolean> {
  const rows = await db
    .insert(jobs)
    .values({
      type: input.type,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      maxAttempts: input.maxAttempts ?? 5,
      runAt: input.runAt ?? new Date(),
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/**
 * 실행할 job 을 가져오며 잠근다. FOR UPDATE SKIP LOCKED 로 여러 worker 가 같은 job 을 가져가지 않는다.
 */
export async function claimJobs(
  db: Database,
  options: { limit: number; workerId: string; types?: JobType[]; now?: Date },
): Promise<Job[]> {
  const now = (options.now ?? new Date()).toISOString();
  const typeFilter = options.types?.length
    ? sql`and type in (${sql.join(
        options.types.map((t) => sql`${t}::job_type`),
        sql`, `,
      )})`
    : sql``;
  const result = await db.execute<Record<string, unknown>>(sql`
    update jobs set status = 'processing', attempts = attempts + 1,
      locked_at = ${now}::timestamptz, locked_by = ${options.workerId}, updated_at = ${now}::timestamptz
    where id in (
      select id from jobs
      where status in ('pending', 'retrying') and run_at <= ${now}::timestamptz ${typeFilter}
      order by run_at, created_at
      limit ${options.limit}
      for update skip locked
    )
    returning id`);
  const ids = (result as unknown as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return [];
  return db.select().from(jobs).where(inArray(jobs.id, ids));
}

export async function completeJob(db: Database, id: string, now = new Date()) {
  await db
    .update(jobs)
    .set({ status: "completed", lockedAt: null, lockedBy: null, lastError: null, updatedAt: now })
    .where(eq(jobs.id, id));
}

/** 지수 backoff: 30s, 60s, 120s ... 최대 1시간 */
export function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * 실패 처리. retryable 이고 시도 횟수가 남았으면 retrying + nextRunAt, 아니면 failed.
 * 영원히 재시도하지 않는다 (maxAttempts).
 */
export async function failJob(
  db: Database,
  job: Pick<Job, "id" | "attempts" | "maxAttempts">,
  error: { message: string; retryable: boolean },
  now = new Date(),
): Promise<"retrying" | "failed"> {
  const canRetry = error.retryable && job.attempts < job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: canRetry ? "retrying" : "failed",
      runAt: canRetry ? new Date(now.getTime() + retryDelayMs(job.attempts)) : now,
      lockedAt: null,
      lockedBy: null,
      lastError: error.message.slice(0, 1000),
      updatedAt: now,
    })
    .where(eq(jobs.id, job.id));
  return canRetry ? "retrying" : "failed";
}

/** 처리 중에 프로세스가 죽어 남은 job 을 되살린다 */
export async function recoverStaleJobs(
  db: Database,
  staleAfterMs = 15 * 60 * 1000,
  now = new Date(),
) {
  const rows = await db
    .update(jobs)
    .set({ status: "retrying", lockedAt: null, lockedBy: null, updatedAt: now })
    .where(
      and(eq(jobs.status, "processing"), lt(jobs.lockedAt, new Date(now.getTime() - staleAfterMs))),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

/** 관리자 수동 재시도: 실패한 job 을 처음부터 다시 */
export async function retryFailedJob(db: Database, id: string, now = new Date()) {
  await db
    .update(jobs)
    .set({ status: "pending", attempts: 0, runAt: now, lastError: null, updatedAt: now })
    .where(and(eq(jobs.id, id), eq(jobs.status, "failed")));
}

/** 관리자가 영구 실패(dead) job 을 확인하고 무시 처리 (기록은 남는다) */
export async function dismissFailedJob(db: Database, id: string, now = new Date()) {
  const rows = await db
    .update(jobs)
    .set({ status: "dismissed", updatedAt: now })
    .where(and(eq(jobs.id, id), eq(jobs.status, "failed")))
    .returning({ id: jobs.id });
  return rows.length > 0;
}
