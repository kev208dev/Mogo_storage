import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { schedulerHeartbeats } from "@/db/schema";

/**
 * scheduler heartbeat · stale 판정.
 * cron endpoint 가 실행될 때마다 heartbeat 를 남기고, watchdog 이 기대 주기 대비 늦었거나
 * 연속 실패 중인 task 를 찾는다. heartbeat 기록 실패는 cron 자체를 실패시키지 않는다.
 */

export type HeartbeatStatus = "running" | "ok" | "skipped" | "failed";

export interface ScheduledTaskSpec {
  task: string;
  label: string;
  /** 기대 실행 주기(분). 사람이 읽는 값 */
  cadenceMinutes: number;
  /** 마지막 실행 이후 이 시간(분)이 지나면 stale — GitHub schedule 지연을 감안해 여유를 둔다 */
  staleAfterMinutes: number;
  /** 연속 실패가 이 횟수 이상이면 failing */
  failingAfter: number;
  /** 이 task 가 운영에서 켜져 있는가 (꺼져 있으면 감시하지 않는다) */
  enabled: (env: Record<string, string | undefined>) => boolean;
}

export const SCHEDULED_TASKS: ScheduledTaskSpec[] = [
  {
    task: "grade-cuts",
    label: "등급컷 watch",
    cadenceMinutes: 5,
    staleAfterMinutes: 45,
    failingAfter: 3,
    enabled: (env) => env.GRADE_CUT_INGESTION_ENABLED === "true",
  },
  {
    task: "scheduled",
    label: "정기 수집",
    cadenceMinutes: 10,
    staleAfterMinutes: 90,
    failingAfter: 3,
    enabled: (env) => env.INGESTION_ENABLED === "true",
  },
  {
    task: "watchdog",
    label: "scheduler watchdog",
    cadenceMinutes: 60,
    staleAfterMinutes: 36 * 60,
    failingAfter: 2,
    enabled: () => true,
  },
];

export type TaskHealthState = "ok" | "stale" | "failing" | "never_run" | "disabled";

export interface HeartbeatRow {
  task: string;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastSuccessAt: Date | null;
  lastStatus: string | null;
  lastDetail: string | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  runCount: number;
}

export interface TaskHealth {
  task: string;
  label: string;
  state: TaskHealthState;
  cadenceMinutes: number;
  staleAfterMinutes: number;
  lastSeenAt: Date | null;
  lastSuccessAt: Date | null;
  minutesSinceSeen: number | null;
  consecutiveFailures: number;
  lastStatus: string | null;
  lastDetail: string | null;
}

/** env 로 stale 기준 조정: SCHEDULER_STALE_MINUTES_GRADE_CUTS=60 */
function staleMinutes(spec: ScheduledTaskSpec, env: Record<string, string | undefined>): number {
  const raw = env[`SCHEDULER_STALE_MINUTES_${spec.task.toUpperCase().replace(/-/g, "_")}`];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= spec.cadenceMinutes ? n : spec.staleAfterMinutes;
}

export function evaluateSchedulerHealth(
  rows: HeartbeatRow[],
  now: Date,
  env: Record<string, string | undefined> = process.env,
  specs: ScheduledTaskSpec[] = SCHEDULED_TASKS,
): TaskHealth[] {
  const byTask = new Map(rows.map((r) => [r.task, r]));
  return specs.map((spec) => {
    const row = byTask.get(spec.task);
    const staleAfter = staleMinutes(spec, env);
    const lastSeenAt = row
      ? ([row.lastFinishedAt, row.lastStartedAt]
          .filter((d): d is Date => d instanceof Date)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null)
      : null;
    const minutesSinceSeen = lastSeenAt
      ? Math.floor((now.getTime() - lastSeenAt.getTime()) / 60_000)
      : null;
    let state: TaskHealthState;
    if (!spec.enabled(env)) state = "disabled";
    else if (!lastSeenAt) state = "never_run";
    else if (minutesSinceSeen! > staleAfter) state = "stale";
    else if ((row?.consecutiveFailures ?? 0) >= spec.failingAfter) state = "failing";
    else state = "ok";
    return {
      task: spec.task,
      label: spec.label,
      state,
      cadenceMinutes: spec.cadenceMinutes,
      staleAfterMinutes: staleAfter,
      lastSeenAt,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      minutesSinceSeen,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      lastStatus: row?.lastStatus ?? null,
      lastDetail: row?.lastDetail ?? null,
    };
  });
}

/** 상태 코드는 짧은 식별자만 허용 (오류 메시지·URL·비밀값이 섞이지 않게) */
export function safeDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return /^[a-z0-9_.:-]{1,64}$/i.test(detail) ? detail : "other";
}

export async function recordTaskStart(db: Database, task: string, now: Date): Promise<void> {
  try {
    await db
      .insert(schedulerHeartbeats)
      .values({ task, lastStartedAt: now, lastStatus: "running", runCount: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: schedulerHeartbeats.task,
        set: {
          lastStartedAt: now,
          lastStatus: "running",
          runCount: sql`${schedulerHeartbeats.runCount} + 1`,
          updatedAt: now,
        },
      });
  } catch (error) {
    logHeartbeatFailure(task, error);
  }
}

export async function recordTaskFinish(
  db: Database,
  task: string,
  result: { status: Exclude<HeartbeatStatus, "running">; detail?: string | null; startedAt: Date },
  now: Date,
): Promise<void> {
  const detail = safeDetail(result.detail);
  const durationMs = Math.max(0, now.getTime() - result.startedAt.getTime());
  try {
    await db
      .insert(schedulerHeartbeats)
      .values({
        task,
        lastStartedAt: result.startedAt,
        lastFinishedAt: now,
        lastSuccessAt: result.status === "ok" ? now : null,
        lastStatus: result.status,
        lastDetail: detail,
        lastDurationMs: durationMs,
        consecutiveFailures: result.status === "failed" ? 1 : 0,
        runCount: 1,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schedulerHeartbeats.task,
        set: {
          lastFinishedAt: now,
          lastStatus: result.status,
          lastDetail: detail,
          lastDurationMs: durationMs,
          updatedAt: now,
          ...(result.status === "ok"
            ? { lastSuccessAt: now, consecutiveFailures: 0 }
            : result.status === "failed"
              ? { consecutiveFailures: sql`${schedulerHeartbeats.consecutiveFailures} + 1` }
              : {}),
        },
      });
  } catch (error) {
    logHeartbeatFailure(task, error);
  }
}

export async function loadHeartbeats(db: Database): Promise<HeartbeatRow[] | null> {
  try {
    return await db.select().from(schedulerHeartbeats);
  } catch (error) {
    // migration 이 아직 적용되지 않은 DB (테이블 없음) 등
    logHeartbeatFailure("load", error);
    return null;
  }
}

export async function loadHeartbeat(db: Database, task: string): Promise<HeartbeatRow | null> {
  const [row] = await db
    .select()
    .from(schedulerHeartbeats)
    .where(eq(schedulerHeartbeats.task, task));
  return row ?? null;
}

function logHeartbeatFailure(task: string, error: unknown) {
  const code = (error as { code?: unknown })?.code;
  console.warn(
    JSON.stringify({
      event: "scheduler.heartbeat_failed",
      task,
      pgCode: typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined,
    }),
  );
}
