import { and, desc, eq, sql } from "drizzle-orm";
import { examFiles, examSchedules, ingestionRuns } from "../db/schema";
import type { Grade, Subject } from "../lib/constants";
import { ingestionEnabled, queueRechecks } from "./backfill";
import type { IngestionContext } from "./context";
import { runJobs, type WorkerResult } from "./jobs/worker";
import { runDiscovery, type DiscoveryResult } from "./pipeline/discovery";
import { withAdvisoryLock } from "./pipeline/locks";
import { loadPriorities, loadSources } from "./pipeline/sources";
import {
  computeReleaseWindow,
  isPollDue,
  isWithinWindow,
  SCHEDULED_DISCOVERY_INTERVAL_SECONDS,
} from "./schedule/release-window";
import { loadWatchableSchedules } from "./schedule/schedules";
import { rankSources } from "./sources/config";

async function lastRunAt(
  ctx: IngestionContext,
  sourceId: string,
  mode: "scheduled" | "release_watch",
  scope?: string,
) {
  const conditions = [eq(ingestionRuns.sourceId, sourceId), eq(ingestionRuns.mode, mode)];
  if (scope) conditions.push(sql`${ingestionRuns.metadata}->>'scope' = ${scope}`);
  const [row] = await ctx.db
    .select({ startedAt: ingestionRuns.startedAt })
    .from(ingestionRuns)
    .where(and(...conditions))
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

/** 자료가 있어야 할 슬롯 (영어는 듣기 포함) */
export function expectedSlots(subjects: Subject[]) {
  return subjects.flatMap((subject) => [
    { subject, type: "question" as const },
    { subject, type: "solution" as const },
    ...(subject === "english" ? [{ subject, type: "listening_audio" as const }] : []),
  ]);
}

export interface ReleaseWatchResult {
  schedules: Array<{ scheduleId: string; exam: string; state: string; polled: string[] }>;
  jobs: WorkerResult | null;
}

/**
 * RELEASE WATCH: 시험 당일 예상 공개 시간대에만 짧은 간격(source 별 최소 간격 준수)으로 해당 시험만 확인한다.
 * 발견된 자료는 곧바로 job 으로 검증·게시된다.
 */
export async function runReleaseWatch(ctx: IngestionContext): Promise<ReleaseWatchResult> {
  const now = ctx.now();
  const result: ReleaseWatchResult = { schedules: [], jobs: null };
  const sources = (await loadSources(ctx.db)).filter(
    (s) => s.enabled && (ctx.allowUnverifiedSources || s.liveVerified),
  );
  const schedules = await loadWatchableSchedules(ctx.db, now);

  for (const schedule of schedules) {
    const window = computeReleaseWindow(schedule);
    const label = `${schedule.year} 고${schedule.grade} ${schedule.month}월`;
    const entry = {
      scheduleId: schedule.id,
      exam: label,
      state: "outside_window",
      polled: [] as string[],
    };
    result.schedules.push(entry);

    if (now > window.end) {
      // 감시 종료: 모든 기대 자료가 모였으면 completed, 아니면 정기 수집에 맡긴다
      const complete = schedule.examId ? await isExamComplete(ctx, schedule.examId) : false;
      await ctx.db
        .update(examSchedules)
        .set({
          status: complete
            ? "completed"
            : schedule.status === "watching"
              ? "scheduled"
              : schedule.status,
          updatedAt: now,
        })
        .where(eq(examSchedules.id, schedule.id));
      entry.state = complete ? "completed" : "window_closed";
      continue;
    }
    if (!isWithinWindow(window, now)) continue;
    entry.state = "watching";
    if (schedule.status === "scheduled") {
      await ctx.db
        .update(examSchedules)
        .set({ status: "watching", updatedAt: now })
        .where(eq(examSchedules.id, schedule.id));
    }

    const priorities = await loadPriorities(ctx.db, schedule.examType);
    const ordered = rankSources(
      sources.map((s) => s.id),
      priorities,
    )
      .map((id) => sources.find((s) => s.id === id)!)
      .filter(Boolean);
    const scope = `${schedule.year}-${schedule.grade}-${schedule.month}`;
    for (const source of ordered) {
      const last = await lastRunAt(ctx, source.id, "release_watch", scope);
      if (!isPollDue(last, source.minPollIntervalSeconds, now)) continue;
      entry.polled.push(source.id);
      await runDiscovery(ctx, {
        source,
        mode: "release_watch",
        exams: [
          {
            year: schedule.year,
            grade: schedule.grade as Grade,
            month: schedule.month,
            examType: schedule.examType,
            academicYear: schedule.examType === "school_mock" ? null : schedule.year + 1,
          },
        ],
        metadata: { scope, scheduleId: schedule.id },
      });
    }
    ctx.logger.info("release_watch.tick", {
      scheduleId: schedule.id,
      exam: label,
      polled: entry.polled,
    });
  }
  // 발견 즉시 검증·게시 (전체 자료가 모이기를 기다리지 않음)
  if (result.schedules.some((s) => s.polled.length)) {
    result.jobs = await runJobs(ctx, { timeBudgetMs: 45_000 });
  }
  return result;
}

async function isExamComplete(ctx: IngestionContext, examId: string): Promise<boolean> {
  const files = await ctx.db
    .select({ subject: examFiles.subject, type: examFiles.type })
    .from(examFiles)
    .where(eq(examFiles.examId, examId));
  const subjects = [...new Set(files.map((f) => f.subject))];
  if (subjects.length === 0) return false;
  return expectedSlots(subjects).every((slot) =>
    files.some((f) => f.subject === slot.subject && f.type === slot.type),
  );
}

export interface ScheduledResult {
  skipped?: string;
  discovery: Array<{ source: string; result: DiscoveryResult | "not_due" }>;
  releaseWatch: ReleaseWatchResult | null;
  rechecksQueued: number;
  jobs: WorkerResult | null;
}

/**
 * 정기 수집 (cron 이 자주 호출해도 됨):
 *  1) 시험일이 가까운/지난 일정 release watch
 *  2) source 별 정기 discovery (최근 2년, 6시간 간격)
 *  3) 오래 확인하지 않은 ready 자료 재검증 예약 (내용 변경 감지)
 *  4) job 처리
 */
export async function runScheduledIngestion(ctx: IngestionContext): Promise<ScheduledResult> {
  if (!ingestionEnabled()) {
    ctx.logger.info("ingestion.skipped", { reason: "INGESTION_ENABLED is not true" });
    return {
      skipped: "INGESTION_ENABLED is not true",
      discovery: [],
      releaseWatch: null,
      rechecksQueued: 0,
      jobs: null,
    };
  }
  const outcome = await withAdvisoryLock(ctx.db, "ingest:scheduled", async () => {
    const now = ctx.now();
    const result: ScheduledResult = {
      discovery: [],
      releaseWatch: null,
      rechecksQueued: 0,
      jobs: null,
    };
    result.releaseWatch = await runReleaseWatch(ctx);

    for (const source of (await loadSources(ctx.db)).filter(
      (s) => s.enabled && (ctx.allowUnverifiedSources || s.liveVerified),
    )) {
      const last = await lastRunAt(ctx, source.id, "scheduled");
      if (!isPollDue(last, SCHEDULED_DISCOVERY_INTERVAL_SECONDS, now)) {
        result.discovery.push({ source: source.id, result: "not_due" });
        continue;
      }
      result.discovery.push({
        source: source.id,
        result: await runDiscovery(ctx, {
          source,
          mode: "scheduled",
          options: { fromYear: now.getFullYear() - 1, toYear: now.getFullYear() },
        }),
      });
    }
    result.rechecksQueued = await queueRechecks(ctx);
    result.jobs = await runJobs(ctx, { timeBudgetMs: 60_000 });
    return result;
  });
  if (!outcome.acquired) {
    return {
      skipped: "another scheduled run is in progress",
      discovery: [],
      releaseWatch: null,
      rechecksQueued: 0,
      jobs: null,
    };
  }
  return outcome.value;
}
