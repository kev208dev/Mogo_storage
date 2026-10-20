import type { WorkerResult } from "../jobs/worker";
import type { ReleaseWatchResult, ScheduledResult } from "../watch";
import type { HeartbeatStatus } from "./scheduler";

/**
 * cron task 결과 → heartbeat (status + 짧은 상태 코드).
 *
 * "HTTP 200 으로 끝났다" 와 "할 일을 했다" 를 구분해 남긴다. 예전에는 lock 때문에 건너뛴 실행,
 * 정책상 실행할 수 있는 source 가 하나도 없는 실행, 모든 discovery 가 실패한 실행도 전부 ok 로
 * 기록돼 watchdog·관리자 화면에서 정상처럼 보였다.
 *
 * detail 은 scheduler.safeDetail 형식([a-z0-9_.:-])만 쓴다. 오류 메시지·URL 은 넣지 않는다.
 */
export interface TaskHeartbeat {
  status: Exclude<HeartbeatStatus, "running">;
  detail?: string;
}

function workerDetail(jobs: WorkerResult | null): string[] {
  if (!jobs) return [];
  const parts: string[] = [];
  if (jobs.failed > 0) parts.push("jobs_dead");
  if (jobs.lost > 0) parts.push("jobs_lost");
  return parts;
}

export function scheduledHeartbeat(result: ScheduledResult): TaskHeartbeat {
  if (result.skipped) {
    // INGESTION_ENABLED 는 route 에서 먼저 확인하므로 여기 오는 skip 은 advisory lock 경합이다
    return {
      status: "skipped",
      detail: /progress/.test(result.skipped) ? "locked" : "disabled",
    };
  }
  const ran = result.discovery.filter((d) => d.result !== "not_due");
  const failed = ran.filter((d) => d.result !== "not_due" && d.result.status === "failed");
  if (ran.length > 0 && failed.length === ran.length)
    return { status: "failed", detail: "discovery_failed" };

  const parts: string[] = [];
  // 정책(robots·anti-bot)상 discovery 가 허용된 source 가 없다 — 정상 동작이지만 "수집 중" 은 아니다
  if (result.discovery.length === 0) parts.push("no_runnable_sources");
  else if (failed.length > 0) parts.push("discovery_partial");
  parts.push(...workerDetail(result.jobs));
  return { status: "ok", detail: parts.join(".") || undefined };
}

export function releaseWatchHeartbeat(result: ReleaseWatchResult): TaskHeartbeat {
  const polled = result.schedules.some((s) => s.polled.length > 0);
  const parts = [polled ? "polled" : "idle", ...workerDetail(result.jobs)];
  return { status: "ok", detail: parts.join(".") };
}

export function jobsHeartbeat(result: WorkerResult): TaskHeartbeat {
  const parts = ["queue_worker", ...workerDetail(result)];
  return { status: "ok", detail: parts.join(".") };
}
