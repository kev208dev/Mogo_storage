import type { IngestionContext } from "../context";
import { toIngestionError } from "../errors";
import { JOB_HANDLERS } from "./registry";
import { claimJobs, completeJob, failJob, recoverStaleJobs, releaseJob, type Job } from "./queue";

export interface WorkerResult {
  processed: number;
  completed: number;
  retrying: number;
  failed: number;
  /** claim 했지만 시간 예산이 끝나 시작하지 않고 queue 로 돌려준 job */
  released: number;
}

type Handlers = Record<Job["type"], (ctx: IngestionContext, job: Job) => Promise<void>>;

/**
 * job queue 처리. 시간 예산 안에서 claim → 처리 → 완료/재시도/실패 기록을 반복한다.
 * 여러 worker 가 동시에 돌아도 FOR UPDATE SKIP LOCKED 덕분에 같은 job 을 두 번 처리하지 않는다.
 * 시간 예산은 job 하나를 시작하기 전마다 확인한다 (batch 단위로만 확인하면 느린 PROCESS job 이
 * 여러 개 이어질 때 serverless 함수 제한 시간을 넘긴다). 예산이 끝나면 남은 claim 은 돌려준다.
 */
export async function runJobs(
  ctx: IngestionContext,
  options: { limit?: number; timeBudgetMs?: number; batchSize?: number; handlers?: Handlers } = {},
): Promise<WorkerResult> {
  const limit = options.limit ?? 200;
  const handlers = options.handlers ?? JOB_HANDLERS;
  const deadline = Date.now() + (options.timeBudgetMs ?? 60_000);
  const result: WorkerResult = { processed: 0, completed: 0, retrying: 0, failed: 0, released: 0 };
  await recoverStaleJobs(ctx.db, 15 * 60 * 1000, ctx.now());

  while (result.processed < limit && Date.now() < deadline) {
    const batch = await claimJobs(ctx.db, {
      limit: Math.min(options.batchSize ?? 5, limit - result.processed),
      workerId: ctx.workerId,
      now: ctx.now(),
    });
    if (batch.length === 0) break;
    for (const [index, job] of batch.entries()) {
      if (Date.now() >= deadline) {
        for (const rest of batch.slice(index)) await releaseJob(ctx.db, rest, ctx.now());
        result.released += batch.length - index;
        return result;
      }
      result.processed += 1;
      try {
        await handlers[job.type](ctx, job);
        await completeJob(ctx.db, job.id, ctx.now());
        result.completed += 1;
      } catch (error) {
        const e = toIngestionError(error);
        const outcome = await failJob(
          ctx.db,
          job,
          { message: `${e.code}: ${e.message}`, retryable: e.retryable },
          ctx.now(),
        );
        ctx.logger[outcome === "failed" ? "error" : "warn"](
          outcome === "failed" ? "job.failed" : "job.retry_scheduled",
          {
            jobId: job.id,
            jobType: job.type,
            attempts: job.attempts,
            code: e.code,
            message: e.message,
          },
        );
        if (outcome === "failed") {
          result.failed += 1;
          await ctx.notifier.notify({
            kind: "job_dead",
            jobType: job.type,
            jobId: job.id,
            message: `${e.code}: ${e.message}`.slice(0, 300),
          });
        } else result.retrying += 1;
      }
    }
  }
  return result;
}
