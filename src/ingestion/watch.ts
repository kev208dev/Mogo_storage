import { and, desc, eq, sql } from "drizzle-orm";
import { examSchedules, ingestionRuns } from "../db/schema";
import type { Grade } from "../lib/constants";
import { ingestionEnabled, queueRechecks } from "./backfill";
import type { IngestionContext } from "./context";
import { runJobs, type WorkerResult } from "./jobs/worker";
import { runDiscovery, type DiscoveryResult } from "./pipeline/discovery";
import { withAdvisoryLock } from "./pipeline/locks";
import { loadPriorities, loadSources } from "./pipeline/sources";
import {
  applyOfficialReleaseTimes,
  ensureWatchStates,
  hasOfficialTimes,
  loadWatchStates,
  markPolled,
  planPoll,
  refreshWatchStates,
  toWatchSlots,
  type PollPhase,
} from "./schedule/artifact-watch";
import {
  computeReleaseWindow,
  isPollDue,
  SCHEDULED_DISCOVERY_INTERVAL_SECONDS,
} from "./schedule/release-window";
import { loadWatchableSchedules } from "./schedule/schedules";
import { rankSources } from "./sources/config";
import { canRun } from "./sources/verification";
import type { PageType } from "./types";

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

export { expectedSlots } from "./schedule/artifact-watch";

export interface ReleaseWatchResult {
  schedules: Array<{
    scheduleId: string;
    exam: string;
    state: string;
    polled: string[];
    /** 자료 단위 감시 단계 (complete / idle / fetch_release_times / pre_release / released / backoff) */
    phase?: PollPhase;
    waiting?: number;
    /** 공식 공개 시각을 반영한 슬롯 수 */
    officialTimesApplied?: number;
  }>;
  jobs: WorkerResult | null;
}

/**
 * RELEASE WATCH: 시험 당일, 자료 단위(영역·세부과목·종류)로 남은 자료만 확인한다.
 *  - 확인 시작 시각: 공식 공개 시각(source) > 일정 metadata > 기본 공개 시간대
 *  - 공개 예정 2분 전부터 낮은 빈도, 공개 이후 source 최소 간격 (source 예절 준수)
 *  - 발견된 자료는 곧바로 job 으로 검증·게시되고, 그 슬롯은 found 가 되어 더 이상 기다리지 않는다
 *  - 모든 슬롯이 found 면 시험 감시 종료 (이미 받은 파일을 반복 요청하지 않음)
 */
export async function runReleaseWatch(ctx: IngestionContext): Promise<ReleaseWatchResult> {
  const now = ctx.now();
  const result: ReleaseWatchResult = { schedules: [], jobs: null };
  // release watch 기능까지 켜진 source 만 (검증·승인 + health + 단계적 활성화)
  const sources = (await loadSources(ctx.db)).filter((s) =>
    canRun(s, "release_watch", { allowUnverified: ctx.allowUnverifiedSources }),
  );
  const schedules = await loadWatchableSchedules(ctx.db, now);

  for (const schedule of schedules) {
    const window = computeReleaseWindow(schedule);
    const label = `${schedule.year} 고${schedule.grade} ${schedule.month}월`;
    const entry: ReleaseWatchResult["schedules"][number] = {
      scheduleId: schedule.id,
      exam: label,
      state: "outside_window",
      polled: [],
    };
    result.schedules.push(entry);

    if (schedule.examId) await ensureWatchStates(ctx.db, schedule);

    if (now > window.end) {
      // 감시 종료: 남은 슬롯은 missed → 정기 수집에 맡긴다
      const refreshed = schedule.examId
        ? await refreshWatchStates(ctx.db, { examId: schedule.examId, now, windowEnd: window.end })
        : null;
      const complete = Boolean(refreshed && refreshed.missed === 0 && refreshed.found > 0);
      // 이번 tick 에 새로 missed 가 된 슬롯만 알린다 (같은 알림 반복 방지)
      if (refreshed && refreshed.newlyMissed.length > 0) {
        const missed = refreshed.newlyMissed;
        ctx.logger.warn("release_watch.missed", { scheduleId: schedule.id, missed: missed.length });
        await ctx.notifier.notify({
          kind: "release_missed",
          examLabel: label,
          items: missed
            .slice(0, 12)
            .map((m) => `${m.subject}${m.slotKey ? `/${m.slotKey}` : ""} ${m.type}`),
        });
      }
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

    const priorities = await loadPriorities(ctx.db, schedule.examType);
    const ordered = rankSources(
      sources.map((s) => s.id),
      priorities,
    )
      .map((id) => sources.find((s) => s.id === id)!)
      .filter(Boolean);
    const scope = `${schedule.year}-${schedule.grade}-${schedule.month}`;
    const canonical = {
      year: schedule.year,
      grade: schedule.grade as Grade,
      month: schedule.month,
      examType: schedule.examType,
      academicYear: schedule.examType === "school_mock" ? null : schedule.year + 1,
    };
    const examDay = new Date(`${schedule.examDate}T00:00:00+09:00`);
    let officialApplied = 0;
    for (const source of ordered) {
      if (schedule.examId) {
        await refreshWatchStates(ctx.db, { examId: schedule.examId, now });
      }
      const rows = schedule.examId ? await loadWatchStates(ctx.db, schedule.examId) : [];
      const indexPage = schedule.sourcePages.find(
        (p) => p.sourceId === source.id && p.pageType === "exam_release_index",
      );
      const needsReleaseTimes =
        Boolean(indexPage && schedule.examId && now >= examDay) &&
        !(await hasOfficialTimes(ctx.db, schedule.examId!));
      const last = await lastRunAt(ctx, source.id, "release_watch", scope);
      const plan = planPoll({
        states: toWatchSlots(rows),
        now,
        minIntervalSeconds: source.minPollIntervalSeconds,
        lastPolledAt: last,
        needsReleaseTimes,
      });
      entry.phase = plan.phase;
      entry.waiting = plan.waiting;
      if (plan.phase === "complete") {
        // 모든 자료 확보 → 이 시험은 더 이상 확인하지 않는다
        entry.state = "completed";
        await ctx.db
          .update(examSchedules)
          .set({ status: "completed", updatedAt: now })
          .where(eq(examSchedules.id, schedule.id));
        break;
      }
      if (plan.phase === "idle") continue;
      entry.state = "watching";
      if (schedule.status === "scheduled") {
        await ctx.db
          .update(examSchedules)
          .set({ status: "watching", updatedAt: now })
          .where(eq(examSchedules.id, schedule.id));
      }
      if (!plan.due) continue;
      entry.polled.push(source.id);
      const page = schedule.sourcePages.find((p) => p.sourceId === source.id);
      const discovery = await runDiscovery(ctx, {
        source,
        mode: "release_watch",
        exams: [
          {
            ...canonical,
            examDate: schedule.examDate,
            ...(page ? { sourceUrl: page.url, pageType: page.pageType as PageType } : {}),
          },
        ],
        metadata: { scope, scheduleId: schedule.id, phase: plan.phase },
      });
      const activeIds = rows.filter((r) =>
        plan.active.some(
          (a) => a.subject === r.subject && a.slotKey === r.slotKey && a.type === r.type,
        ),
      );
      await markPolled(ctx.db, activeIds, now);
      for (const rt of discovery.releaseTimes) {
        officialApplied += await applyOfficialReleaseTimes(ctx.db, {
          examId: rt.examId,
          sourceId: source.id,
          times: rt.times,
          now,
        });
      }
    }
    if (officialApplied) entry.officialTimesApplied = officialApplied;
    ctx.logger.info("release_watch.tick", {
      scheduleId: schedule.id,
      exam: label,
      polled: entry.polled,
      phase: entry.phase,
      waiting: entry.waiting,
    });
  }
  // 발견 즉시 검증·게시 (전체 자료가 모이기를 기다리지 않음)
  if (result.schedules.some((s) => s.polled.length)) {
    result.jobs = await runJobs(ctx, { timeBudgetMs: 45_000 });
    for (const schedule of schedules) {
      if (schedule.examId) await refreshWatchStates(ctx.db, { examId: schedule.examId, now });
    }
  }
  return result;
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

    for (const source of (await loadSources(ctx.db)).filter((s) =>
      canRun(s, "discovery", { allowUnverified: ctx.allowUnverifiedSources }),
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
          // discovery 만 켠 source 는 시험 metadata 만 수집한다
          artifacts: canRun(source, "artifacts", { allowUnverified: ctx.allowUnverifiedSources })
            ? "full"
            : "none",
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
