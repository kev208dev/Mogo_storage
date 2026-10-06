import { NextResponse } from "next/server";
import { ingestionEnabled } from "@/ingestion/backfill";
import { runJobs } from "@/ingestion/jobs/worker";
import { syncBuiltinSources } from "@/ingestion/pipeline/sources";
import { runReleaseWatch, runScheduledIngestion } from "@/ingestion/watch";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { createAppIngestionContext } from "@/lib/server/ingestion-context";
import { getDb } from "@/db/client";
import { withAdvisoryLock } from "@/ingestion/pipeline/locks";
import { runGradeCutWatch, type WatchProgress } from "@/ingestion/grade-cuts/core";
import { createGradeCutStore } from "@/ingestion/grade-cuts/persistence";
import { verifiedGradeCutAdapters } from "@/ingestion/grade-cuts/adapters";
import { examCoursePath, examPath } from "@/lib/exam-path";
import { revalidatePath } from "next/cache";
import { createLogger } from "@/ingestion/logger";
import { createOpsNotifier } from "@/ingestion/notifier";
import { createDbAlertGate, failOpen } from "@/ingestion/ops/alert-gate";
import { recordTaskFinish, recordTaskStart, type HeartbeatStatus } from "@/ingestion/ops/scheduler";
import { runSchedulerWatchdog } from "@/ingestion/ops/watchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TASKS = ["scheduled", "release-watch", "jobs", "grade-cuts", "watchdog"] as const;
type Task = (typeof TASKS)[number];

interface TaskOutcome {
  status: number;
  body: Record<string, unknown>;
  heartbeat: { status: Exclude<HeartbeatStatus, "running">; detail?: string };
}

/**
 * scheduler 공통 진입점 (Vercel Cron, GitHub Actions, Cloudflare Cron Trigger, 일반 cron 이 호출)
 *   GET|POST /api/cron/scheduled      정기 수집 + release watch + job 처리
 *   GET|POST /api/cron/release-watch  시험 당일 감시만
 *   GET|POST /api/cron/jobs           job queue 만
 *   GET|POST /api/cron/grade-cuts     등급컷 watch
 *   GET|POST /api/cron/watchdog       scheduler heartbeat 점검 (stale/연속 실패 알림)
 * 수집 로직은 src/ingestion 에 있고 이 route 는 호출만 한다.
 * 모든 실행은 scheduler_heartbeats 에 기록된다 (기록 실패는 task 결과에 영향 없음).
 */
async function handle(request: Request, ctx: RouteContext<"/api/cron/[task]">) {
  const auth = checkCronAuth(request);
  if (auth === "disabled") return new NextResponse("Not found", { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { task } = await ctx.params;
  if (!(TASKS as readonly string[]).includes(task)) {
    return NextResponse.json({ error: "unknown task" }, { status: 404 });
  }
  const db = getDb();
  const startedAt = new Date();
  if (db) await recordTaskStart(db, task, startedAt);
  const outcome = await runTask(task as Task);
  // 어느 scheduler 가 불렀는지 heartbeat 에 남긴다 (자동 실행과 수동 호출 구분)
  const detail = [triggerSource(request), outcome.heartbeat.detail].filter(Boolean).join(":");
  if (db) await recordTaskFinish(db, task, { ...outcome.heartbeat, detail, startedAt }, new Date());
  return NextResponse.json(outcome.body, {
    status: outcome.status,
    headers: { "cache-control": "no-store" },
  });
}

/** X-Scheduler 헤더(pg_cron, github-actions) 또는 Vercel Cron user-agent. 그 외는 manual */
function triggerSource(request: Request): string {
  const declared = request.headers.get("x-scheduler")?.trim().toLowerCase() ?? "";
  if (/^[a-z0-9_-]{1,20}$/.test(declared)) return declared.replace(/-/g, "_");
  if ((request.headers.get("user-agent") ?? "").startsWith("vercel-cron")) return "vercel_cron";
  return "manual";
}

async function runTask(task: Task): Promise<TaskOutcome> {
  if (task === "watchdog") {
    const db = getDb();
    if (!db)
      return {
        status: 503,
        body: { error: "database not configured" },
        heartbeat: { status: "failed", detail: "no_database" },
      };
    const gate = failOpen(createDbAlertGate(db));
    const result = await runSchedulerWatchdog({
      db,
      gate,
      notifier: createOpsNotifier(createLogger(), process.env, gate),
      now: new Date(),
    });
    return {
      status: result.unavailable ? 503 : 200,
      body: {
        ok: !result.unavailable,
        unavailable: result.unavailable,
        tasks: result.tasks.map((t) => ({
          task: t.task,
          state: t.state,
          minutesSinceSeen: t.minutesSinceSeen,
          staleAfterMinutes: t.staleAfterMinutes,
          consecutiveFailures: t.consecutiveFailures,
          runCount: t.runCount,
          lastStartedAt: t.lastStartedAt,
          lastStatus: t.lastStatus,
          lastDetail: t.lastDetail,
        })),
        alerted: result.alerted,
        recovered: result.recovered,
      },
      heartbeat: result.unavailable
        ? { status: "failed", detail: "heartbeats_unavailable" }
        : { status: "ok", detail: result.alerted.length ? "alerted" : "healthy" },
    };
  }
  if (task === "grade-cuts") {
    if (process.env.GRADE_CUT_INGESTION_ENABLED !== "true")
      return {
        status: 200,
        body: { skipped: "GRADE_CUT_INGESTION_ENABLED is not true" },
        heartbeat: { status: "skipped", detail: "disabled" },
      };
    const db = getDb();
    if (!db)
      return {
        status: 503,
        body: { error: "database not configured" },
        heartbeat: { status: "failed", detail: "no_database" },
      };
    let progress:
      | WatchProgress
      | { stage: "advisory_reserve" | "advisory_lock" | "advisory_unlock" | "advisory_release" } = {
      stage: "advisory_reserve",
    };
    try {
      const started = Date.now();
      const locked = await withAdvisoryLock(
        db,
        "ingest:grade-cuts",
        () =>
          runGradeCutWatch(
            createGradeCutStore(db),
            verifiedGradeCutAdapters,
            new Date(),
            async (exam, slot) => {
              const key = { year: exam.year, grade: exam.grade, month: exam.month };
              revalidatePath(examPath(key));
              revalidatePath(examPath(key, slot.subject));
              if (slot.courseCode)
                revalidatePath(examCoursePath(key, slot.subject, slot.courseCode));
            },
            (source) =>
              console.info(
                JSON.stringify({
                  event: "grade_cut_watch.tick",
                  exam: source.examId,
                  adapter: source.source,
                  requested_slots: source.requested,
                  collected: source.collected,
                  changed: source.changed,
                  finalized: source.finalized,
                  rejected: source.rejected,
                  failures: Number(source.failed),
                  duration_ms: source.durationMs,
                }),
              ),
            (current) => {
              progress = current;
              if (current.stage === "reject_cut")
                console.warn(
                  JSON.stringify({
                    event: "grade_cut_watch.rejected",
                    exam: current.exam,
                    subject: current.subject,
                    course: current.course,
                    reason: current.reason,
                  }),
                );
            },
          ),
        (stage) => {
          progress = { stage };
        },
      );
      console.info(
        JSON.stringify({
          event: "grade_cut_watch.summary",
          acquired: locked.acquired,
          result: locked.acquired ? locked.value : null,
          durationMs: Date.now() - started,
        }),
      );
      return locked.acquired
        ? { status: 200, body: { ok: true, result: locked.value }, heartbeat: { status: "ok" } }
        : {
            status: 200,
            body: { skipped: "locked" },
            heartbeat: { status: "skipped", detail: "locked" },
          };
    } catch (error) {
      console.error("grade_cut_watch.failed", {
        stage: progress.stage,
        exam: "exam" in progress ? progress.exam : undefined,
        subject: "subject" in progress ? progress.subject : undefined,
        course: "course" in progress ? progress.course : undefined,
        errorName: error instanceof Error ? error.name : "unknown",
        // Only standard five-character SQLSTATE codes; never log SQL, URL or credentials.
        pgCode:
          typeof (error as { code?: unknown })?.code === "string" &&
          /^[A-Z0-9]{5}$/.test((error as { code: string }).code)
            ? (error as { code: string }).code
            : undefined,
      });
      return {
        status: 500,
        body: { error: "grade cut watch failed", stage: progress.stage },
        heartbeat: { status: "failed", detail: progress.stage },
      };
    }
  }
  // 이미 검증·승인되어 queue 에 들어온 PROCESS 작업은 외부 discovery 스위치와 독립적으로 처리한다.
  // INGESTION_ENABLED 는 새 외부 수집(scheduled/release-watch)만 제어한다.
  if (task === "jobs") {
    const ingestion = createAppIngestionContext();
    if (!ingestion)
      return {
        status: 503,
        body: { error: "database not configured" },
        heartbeat: { status: "failed", detail: "no_database" },
      };
    try {
      await syncBuiltinSources(ingestion.db);
      const result = await runJobs(ingestion, { timeBudgetMs: 240_000 });
      return {
        status: 200,
        body: { ok: true, task, result },
        heartbeat: { status: "ok", detail: "queue_worker" },
      };
    } catch (error) {
      ingestion.logger.error("ingestion.failed", {
        task,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 500,
        body: { ok: false, error: "ingestion failed (see server logs)" },
        heartbeat: { status: "failed", detail: "exception" },
      };
    }
  }

  if (!ingestionEnabled()) {
    return {
      status: 200,
      body: { skipped: "INGESTION_ENABLED is not true" },
      heartbeat: { status: "skipped", detail: "disabled" },
    };
  }
  const ingestion = createAppIngestionContext();
  if (!ingestion)
    return {
      status: 503,
      body: { error: "database not configured" },
      heartbeat: { status: "failed", detail: "no_database" },
    };

  try {
    await syncBuiltinSources(ingestion.db);
    const result =
      task === "scheduled"
        ? await runScheduledIngestion(ingestion)
        : await runReleaseWatch(ingestion);
    return { status: 200, body: { ok: true, task, result }, heartbeat: { status: "ok" } };
  } catch (error) {
    ingestion.logger.error("ingestion.failed", {
      task,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      status: 500,
      body: { ok: false, error: "ingestion failed (see server logs)" },
      heartbeat: { status: "failed", detail: "exception" },
    };
  }
}

export const GET = handle;
export const POST = handle;
