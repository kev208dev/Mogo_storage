import type { IngestionContext } from "../context";
import type { JobType } from "../constants";
import { toIngestionError } from "../errors";
import { JOB_HANDLERS } from "./registry";
import { claimJobs, completeJob, failJob, recoverStaleJobs } from "./queue";

export interface WorkerResult {
  processed: number;
  completed: number;
  retrying: number;
  failed: number;
}

/**
 * job queue 처리. 시간 예산 안에서 claim → 처리 → 완료/재시도/실패 기록을 반복한다.
 * 여러 worker 가 동시에 돌아도 FOR UPDATE SKIP LOCKED 덕분에 같은 job 을 두 번 처리하지 않는다.
 */
export async function runJobs(
  ctx: IngestionContext,
  options: { limit?: number; timeBudgetMs?: number; batchSize?: number; types?: JobType[] } = {},
): Promise<WorkerResult> {
  const limit = options.limit ?? 200;
  const deadline = Date.now() + (options.timeBudgetMs ?? 60_000);
  const result: WorkerResult = { processed: 0, completed: 0, retrying: 0, failed: 0 };
  await recoverStaleJobs(ctx.db, 15 * 60 * 1000, ctx.now());

  while (result.processed < limit && Date.now() < deadline) {
    const batch = await claimJobs(ctx.db, {
      limit: Math.min(options.batchSize ?? 5, limit - result.processed),
      workerId: ctx.workerId,
      now: ctx.now(),
      types: options.types,
    });
    if (batch.length === 0) break;
    for (const job of batch) {
      result.processed += 1;
      try {
        await JOB_HANDLERS[job.type](ctx, job);
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
