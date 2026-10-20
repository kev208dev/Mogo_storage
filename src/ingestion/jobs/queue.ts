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

/**
 * job 을 잡은 worker 만 결과를 기록한다 (status=processing AND locked_by=worker).
 * 15분 stale 복구로 다른 worker 가 다시 가져간 job 을 늦게 끝난 이전 worker 가 덮어쓰지 않는다.
 * lockedBy 를 모르는 호출(관리자 도구 등)은 id 만으로 기록한다. 기록했으면 true.
 */
function ownedBy(id: string, lockedBy: string | null | undefined) {
  return lockedBy
    ? and(eq(jobs.id, id), eq(jobs.status, "processing"), eq(jobs.lockedBy, lockedBy))
    : eq(jobs.id, id);
}

export async function completeJob(
  db: Database,
  id: string,
  now = new Date(),
  lockedBy?: string | null,
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: "completed", lockedAt: null, lockedBy: null, lastError: null, updatedAt: now })
    .where(ownedBy(id, lockedBy))
    .returning({ id: jobs.id });
  return rows.length > 0;
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
  job: Pick<Job, "id" | "attempts" | "maxAttempts"> & { lockedBy?: string | null },
  error: { message: string; retryable: boolean },
  now = new Date(),
): Promise<"retrying" | "failed" | "lost"> {
  const canRetry = error.retryable && job.attempts < job.maxAttempts;
  const rows = await db
    .update(jobs)
    .set({
      status: canRetry ? "retrying" : "failed",
      runAt: canRetry ? new Date(now.getTime() + retryDelayMs(job.attempts)) : now,
      lockedAt: null,
      lockedBy: null,
      lastError: error.message.slice(0, 1000),
      updatedAt: now,
    })
    .where(ownedBy(job.id, job.lockedBy))
    .returning({ id: jobs.id });
  // 다른 worker 가 이미 다시 가져갔다 (stale 복구) — 그쪽 결과를 덮어쓰지 않는다
  if (rows.length === 0) return "lost";
  return canRetry ? "retrying" : "failed";
}

/**
 * claim 했지만 시간 예산이 끝나 시작하지 못한 job 을 그대로 queue 에 돌려준다.
 * 시도 횟수를 쓰지 않은 것으로 되돌리고 lock 을 푼다 (15분 stale 복구를 기다리지 않는다).
 * 이 worker 가 잡고 있는 processing job 만 바꾼다.
 */
export async function releaseJob(
  db: Database,
  job: Pick<Job, "id" | "attempts" | "lockedBy">,
  now = new Date(),
) {
  const attempts = Math.max(0, job.attempts - 1);
  await db
    .update(jobs)
    .set({
      status: attempts > 0 ? "retrying" : "pending",
      attempts,
      lockedAt: null,
      lockedBy: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.status, "processing"),
        job.lockedBy ? eq(jobs.lockedBy, job.lockedBy) : undefined,
      ),
    );
}

export interface StaleRecovery {
  /** 다시 시도하도록 돌려준 job (backoff 적용) */
  retried: number;
  /** 시도 횟수를 다 써서 failed 로 닫은 job — worker 가 job_dead 알림을 보낸다 */
  dead: Array<Pick<Job, "id" | "type" | "attempts">>;
}

export const STALE_PROCESSING_ERROR =
  "STALE_PROCESSING: 처리 중 worker 가 끝나지 않음 (시간 초과 또는 중단)";

/**
 * 처리 중에 프로세스가 죽어 남은 job 을 되살린다.
 *  - 시도 횟수가 남았으면 retrying + 지수 backoff (같은 job 이 함수를 계속 죽이는 경우 즉시 반복하지 않는다)
 *  - maxAttempts 를 다 썼으면 failed (영원히 되살리지 않는다 — 관리자 [다시 시도]로만 재개)
 * attempts 는 claim 할 때 이미 올렸으므로 여기서는 바꾸지 않는다.
 */
export async function recoverStaleJobs(
  db: Database,
  staleAfterMs = 15 * 60 * 1000,
  now = new Date(),
): Promise<StaleRecovery> {
  const stale = and(
    eq(jobs.status, "processing"),
    lt(jobs.lockedAt, new Date(now.getTime() - staleAfterMs)),
  );
  const dead = await db
    .update(jobs)
    .set({
      status: "failed",
      lockedAt: null,
      lockedBy: null,
      lastError: STALE_PROCESSING_ERROR,
      updatedAt: now,
    })
    .where(and(stale, sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
    .returning({ id: jobs.id, type: jobs.type, attempts: jobs.attempts });
  const retried = await db
    .update(jobs)
    .set({
      status: "retrying",
      lockedAt: null,
      lockedBy: null,
      lastError: STALE_PROCESSING_ERROR,
      // 30s × 2^(attempts-1), 최대 1시간 — failJob 과 같은 backoff
      runAt: sql`${now.toISOString()}::timestamptz + least(interval '1 hour', interval '30 seconds' * power(2, greatest(${jobs.attempts} - 1, 0)))`,
      updatedAt: now,
    })
    .where(and(stale, sql`${jobs.attempts} < ${jobs.maxAttempts}`))
    .returning({ id: jobs.id });
  return { retried: retried.length, dead };
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
