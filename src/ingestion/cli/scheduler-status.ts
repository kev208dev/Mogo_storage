/**
 * cron heartbeat 상태 확인.
 *   npm run ops:scheduler                 상태 출력 (알림 없음)
 *   npm run ops:scheduler -- --json       JSON 출력
 *   npm run ops:scheduler -- --watchdog   stale/연속 실패 알림까지 보냄 (/api/cron/watchdog 와 같은 동작)
 *   --strict                              stale/failing/never_run 이 있으면 exit 1
 */
import { createLogger } from "../logger";
import { createOpsNotifier } from "../notifier";
import { createDbAlertGate, failOpen } from "../ops/alert-gate";
import { evaluateSchedulerHealth, loadHeartbeats } from "../ops/scheduler";
import { runSchedulerWatchdog } from "../ops/watchdog";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  const now = new Date();
  try {
    let tasks;
    if (args.watchdog) {
      const gate = failOpen(createDbAlertGate(db));
      const result = await runSchedulerWatchdog({
        db,
        gate,
        notifier: createOpsNotifier(createLogger(), process.env, gate),
        now,
      });
      if (result.unavailable)
        throw new Error("scheduler_heartbeats 테이블을 읽을 수 없습니다 (migration 확인)");
      tasks = result.tasks;
      if (!args.json)
        console.log(
          `알림: ${result.alerted.join(", ") || "-"} · 복구: ${result.recovered.join(", ") || "-"}`,
        );
    } else {
      const rows = await loadHeartbeats(db);
      if (!rows) throw new Error("scheduler_heartbeats 테이블을 읽을 수 없습니다 (migration 확인)");
      tasks = evaluateSchedulerHealth(rows, now);
    }
    if (args.json) console.log(JSON.stringify(tasks, null, 2));
    else
      for (const t of tasks)
        console.log(
          `${t.task.padEnd(12)} ${t.state.padEnd(9)} 마지막 실행 ${t.lastSeenAt?.toISOString() ?? "-"}` +
            ` (${t.minutesSinceSeen ?? "-"}분 전 / 기준 ${t.staleAfterMinutes}분) · 마지막 성공 ${t.lastSuccessAt?.toISOString() ?? "-"}` +
            ` · 연속 실패 ${t.consecutiveFailures}${t.lastDetail ? ` · ${t.lastDetail}` : ""}`,
        );
    if (args.strict && tasks.some((t) => ["stale", "failing", "never_run"].includes(t.state)))
      process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
