import { NextResponse } from "next/server";
import { ingestionEnabled } from "@/ingestion/backfill";
import { runJobs } from "@/ingestion/jobs/worker";
import { syncBuiltinSources } from "@/ingestion/pipeline/sources";
import { runReleaseWatch, runScheduledIngestion } from "@/ingestion/watch";
import { checkCronAuth } from "@/lib/server/cron-auth";
import { createAppIngestionContext } from "@/lib/server/ingestion-context";
import { getDb } from "@/db/client";
import { withAdvisoryLock } from "@/ingestion/pipeline/locks";
import { runGradeCutWatch } from "@/ingestion/grade-cuts/core";
import { createGradeCutStore } from "@/ingestion/grade-cuts/persistence";
import { verifiedGradeCutAdapters } from "@/ingestion/grade-cuts/adapters";
import { examCoursePath, examPath } from "@/lib/exam-path";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TASKS = ["scheduled", "release-watch", "jobs", "grade-cuts"] as const;

/**
 * scheduler 공통 진입점 (Vercel Cron, GitHub Actions, Cloudflare Cron Trigger, 일반 cron 이 호출)
 *   GET|POST /api/cron/scheduled      정기 수집 + release watch + job 처리
 *   GET|POST /api/cron/release-watch  시험 당일 감시만
 *   GET|POST /api/cron/jobs           job queue 만
 * 수집 로직은 src/ingestion 에 있고 이 route 는 호출만 한다.
 */
async function handle(request: Request, ctx: RouteContext<"/api/cron/[task]">) {
  const auth = checkCronAuth(request);
  if (auth === "disabled") return new NextResponse("Not found", { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { task } = await ctx.params;
  if (!(TASKS as readonly string[]).includes(task)) {
    return NextResponse.json({ error: "unknown task" }, { status: 404 });
  }
  if (task === "grade-cuts") {
    if (process.env.GRADE_CUT_INGESTION_ENABLED !== "true")
      return NextResponse.json({ skipped: "GRADE_CUT_INGESTION_ENABLED is not true" });
    const db = getDb();
    if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
    try {
      const locked = await withAdvisoryLock(db, "ingest:grade-cuts", () =>
        runGradeCutWatch(createGradeCutStore(db), verifiedGradeCutAdapters, new Date(),
          async (exam, slot) => {
            const key = { year: exam.year, grade: exam.grade, month: exam.month };
            revalidatePath(examPath(key));
            revalidatePath(examPath(key, slot.subject));
            if (slot.courseCode) revalidatePath(examCoursePath(key, slot.subject, slot.courseCode));
          }),
      );
      return NextResponse.json(locked.acquired ? { ok: true, result: locked.value } : { skipped: "locked" });
    } catch (error) {
      console.error("grade_cut_watch.failed", error);
      return NextResponse.json({ error: "grade cut watch failed" }, { status: 500 });
    }
  }
  if (!ingestionEnabled()) {
    return NextResponse.json({ skipped: "INGESTION_ENABLED is not true" });
  }
  const ingestion = createAppIngestionContext();
  if (!ingestion) return NextResponse.json({ error: "database not configured" }, { status: 503 });

  try {
    await syncBuiltinSources(ingestion.db);
    const result =
      task === "scheduled"
        ? await runScheduledIngestion(ingestion)
        : task === "release-watch"
          ? await runReleaseWatch(ingestion)
          : await runJobs(ingestion, { timeBudgetMs: 240_000 });
    return NextResponse.json(
      { ok: true, task, result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    ingestion.logger.error("ingestion.failed", {
      task,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: "ingestion failed (see server logs)" },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
