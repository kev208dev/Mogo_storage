import type { Database } from "@/db/client";
import {
  evaluateSchedulerHealth,
  loadHeartbeats,
  type TaskHealthState,
} from "@/ingestion/ops/scheduler";
import { cn } from "@/lib/utils";
import { formatKst, Panel } from "./ui";

const STATE: Record<TaskHealthState, { label: string; className: string }> = {
  ok: { label: "정상", className: "bg-success-soft text-success-strong" },
  stale: { label: "지연", className: "bg-danger-soft text-danger-strong" },
  failing: { label: "연속 실패", className: "bg-danger-soft text-danger-strong" },
  never_run: { label: "실행 기록 없음", className: "bg-warning-soft text-warning-strong" },
  disabled: { label: "꺼짐", className: "bg-muted text-muted-foreground" },
};

/** cron heartbeat 상태 (관리자 전용 — 공개 /api/health 에는 노출하지 않는다) */
export async function SchedulerPanel({ db, now = new Date() }: { db: Database; now?: Date }) {
  const rows = await loadHeartbeats(db);
  if (!rows)
    return (
      <Panel title="Scheduler 상태">
        <p className="text-muted-foreground text-sm">
          heartbeat 테이블이 없습니다 — <code>npm run db:migrate:prod</code> 로 migration 을
          적용하세요.
        </p>
      </Panel>
    );
  const tasks = evaluateSchedulerHealth(rows, now);
  return (
    <Panel title="Scheduler 상태">
      <table className="w-full text-left text-sm" data-testid="scheduler-status">
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th className="py-1">작업</th>
            <th>상태</th>
            <th>마지막 실행</th>
            <th>마지막 성공</th>
            <th className="text-right">연속 실패</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {tasks.map((t) => (
            <tr key={t.task}>
              <td className="py-1.5">
                <span className="font-semibold">{t.label}</span>{" "}
                <span className="text-muted-foreground text-xs">
                  {t.task} · 기대 {t.cadenceMinutes}분 / 지연 기준 {t.staleAfterMinutes}분
                </span>
              </td>
              <td>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs font-bold",
                    STATE[t.state].className,
                  )}
                >
                  {STATE[t.state].label}
                </span>
                {t.lastDetail ? (
                  <span className="text-muted-foreground ml-1 text-xs">{t.lastDetail}</span>
                ) : null}
              </td>
              <td className="tabular-nums">
                {formatKst(t.lastSeenAt)}
                {t.minutesSinceSeen !== null ? (
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    ({t.minutesSinceSeen}분 전)
                  </span>
                ) : null}
              </td>
              <td className="tabular-nums">{formatKst(t.lastSuccessAt)}</td>
              <td className="text-right tabular-nums">{t.consecutiveFailures}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
