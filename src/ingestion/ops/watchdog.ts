import type { Database } from "@/db/client";
import { schedulerAlertKey, type OpsNotifier } from "../notifier";
import type { AlertGate } from "./alert-gate";
import {
  SCHEDULED_TASKS,
  evaluateSchedulerHealth,
  loadHeartbeats,
  type ScheduledTaskSpec,
  type TaskHealth,
} from "./scheduler";

export interface WatchdogResult {
  /** heartbeat 테이블을 읽지 못함 (migration 미적용 등) */
  unavailable: boolean;
  tasks: TaskHealth[];
  alerted: string[];
  recovered: string[];
}

/**
 * cron heartbeat 를 점검해 stale·연속 실패를 알린다 (중복은 notifier 의 gate 가 막는다).
 * 정상으로 돌아온 task 는 이전 알림이 있었을 때만 복구 알림을 보낸다.
 * watchdog 자신은 Vercel Cron(매일) + GitHub Actions(매시) 두 곳에서 호출해 한쪽 scheduler 가 멈춰도 감지한다.
 */
export async function runSchedulerWatchdog(input: {
  db: Database;
  notifier: OpsNotifier;
  gate: AlertGate;
  now: Date;
  env?: Record<string, string | undefined>;
  specs?: ScheduledTaskSpec[];
}): Promise<WatchdogResult> {
  const env = input.env ?? process.env;
  const rows = await loadHeartbeats(input.db);
  if (!rows) return { unavailable: true, tasks: [], alerted: [], recovered: [] };
  const specs = (input.specs ?? SCHEDULED_TASKS).filter((s) => s.task !== "watchdog");
  const tasks = evaluateSchedulerHealth(rows, input.now, env, specs);
  const alerted: string[] = [];
  const recovered: string[] = [];
  for (const t of tasks) {
    if (t.state === "stale" || t.state === "never_run") {
      await input.notifier.notify({
        kind: "scheduler_stale",
        task: t.task,
        label: t.label,
        minutesSinceSeen: t.minutesSinceSeen,
      });
      alerted.push(t.task);
    } else if (t.state === "failing") {
      await input.notifier.notify({
        kind: "scheduler_failing",
        task: t.task,
        label: t.label,
        consecutiveFailures: t.consecutiveFailures,
      });
      alerted.push(t.task);
    } else if (t.state === "ok" && (await input.gate.clear(schedulerAlertKey(t.task)))) {
      await input.notifier.notify({ kind: "scheduler_recovered", task: t.task, label: t.label });
      recovered.push(t.task);
    }
  }
  return { unavailable: false, tasks, alerted, recovered };
}
