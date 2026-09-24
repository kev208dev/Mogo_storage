import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { ingestionCheckpoints, ingestionRuns, sourceArtifacts } from "../db/schema";
import { GRADES, type Grade } from "../lib/constants";
import type { IngestionContext } from "./context";
import { enqueueJob } from "./jobs/queue";
import { runJobs } from "./jobs/worker";
import { urlHash } from "./pipeline/artifacts";
import { runDiscovery, type DiscoveryResult } from "./pipeline/discovery";
import { loadSources } from "./pipeline/sources";
import { canaryGate } from "./audit";
import { canRun } from "./sources/verification";
import type { SourceConfig } from "./types";

/** 로컬 개발에서 실제 외부 수집이 자동 실행되지 않도록 기본은 꺼져 있다 */
export function ingestionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INGESTION_ENABLED === "true";
}

export interface BackfillOptions {
  sourceIds?: string[];
  fromYear: number;
  toYear: number;
  grades?: Grade[];
  force?: boolean;
  runJobs?: boolean;
  jobTimeBudgetMs?: number;
  /**
   * Exam · ExamSubject · SourceExam · SourceArtifact(공식 URL) 까지만 만든다.
   * 파일 검증·다운로드·mirror·게시는 하지 않는다 (1차 backfill 용).
   */
  metadataOnly?: boolean;
}

export interface BackfillScopeResult {
  source: string;
  scope: string;
  status: "done" | "skipped_checkpoint" | "blocked_canary" | DiscoveryResult["status"];
  counts?: DiscoveryResult["counts"];
  message?: string;
}

/**
 * BACKFILL: 과거 시험을 (source, 연도, 학년) 범위 단위로 수집한다.
 * 범위마다 checkpoint 를 남겨, 중간에 실패해도 다시 실행하면 완료된 범위를 건너뛴다.
 * 이미 있는 시험/자료는 update/skip 되며 중복 생성되지 않는다.
 */
export async function runBackfill(ctx: IngestionContext, options: BackfillOptions) {
  const selected = (await loadSources(ctx.db)).filter((s) =>
    options.sourceIds?.length ? options.sourceIds.includes(s.id) : s.enabled,
  );
  // 실제 페이지 fixture 로 검증·승인되고 discovery 기능이 켜진 source 만 (--source 로 지정해도 마찬가지)
  const allow = { allowUnverified: ctx.allowUnverifiedSources };
  const sources = selected.filter((s) => canRun(s, "discovery", allow));
  for (const s of selected.filter((x) => !sources.includes(x))) {
    ctx.logger.warn("ingestion.skipped", {
      source: s.id,
      reason: "source not verified/enabled for discovery",
    });
  }
  const grades = options.grades?.length ? options.grades : [...GRADES];
  const results: BackfillScopeResult[] = [];
  const currentYear = ctx.now().getFullYear();
  for (const source of sources) {
    // canary: 최근 1년 → (audit 통과) → 최근 3년 → (audit 통과) → 전체. 한 번에 전 기간을 돌리지 않는다
    const blocked = await canaryGate(ctx.db, {
      sourceId: source.id,
      fromYear: options.fromYear,
      currentYear,
    });
    if (blocked) {
      ctx.logger.warn("ingestion.skipped", { source: source.id, reason: blocked });
      results.push({
        source: source.id,
        scope: `backfill:${options.fromYear}-${options.toYear}`,
        status: "blocked_canary",
        message: blocked,
      });
      continue;
    }
    // metadata-only 이거나 자료 기능이 꺼져 있으면 자료 검증/게시는 하지 않는다
    const artifacts: "full" | "metadata" | "none" = !canRun(source, "artifacts", allow)
      ? options.metadataOnly
        ? "metadata"
        : "none"
      : options.metadataOnly
        ? "metadata"
        : "full";
    for (let year = options.toYear; year >= options.fromYear; year -= 1) {
      for (const grade of grades) {
        // checkpoint 는 모드별로 따로 (metadata-only 완료가 전체 수집을 건너뛰게 하지 않음)
        const scope = `${artifacts === "full" ? "backfill" : `backfill-${artifacts}`}:${year}:high${grade}`;
        results.push(
          await backfillScope(ctx, source, scope, {
            year,
            grade,
            force: options.force,
            artifacts,
          }),
        );
      }
    }
  }
  const jobs =
    options.runJobs === false || options.metadataOnly
      ? null
      : await runJobs(ctx, { timeBudgetMs: options.jobTimeBudgetMs ?? 120_000, limit: 1000 });
  return { results, jobs };
}

async function backfillScope(
  ctx: IngestionContext,
  source: SourceConfig,
  scope: string,
  input: {
    year: number;
    grade: Grade;
    force?: boolean;
    artifacts: "full" | "metadata" | "none";
  },
): Promise<BackfillScopeResult> {
  const [checkpoint] = await ctx.db
    .select()
    .from(ingestionCheckpoints)
    .where(
      and(eq(ingestionCheckpoints.sourceId, source.id), eq(ingestionCheckpoints.scope, scope)),
    );
  if (checkpoint?.status === "completed" && !input.force) {
    return { source: source.id, scope, status: "skipped_checkpoint" };
  }
  await ctx.db
    .insert(ingestionCheckpoints)
    .values({ sourceId: source.id, scope, status: "running" })
    .onConflictDoUpdate({
      target: [ingestionCheckpoints.sourceId, ingestionCheckpoints.scope],
      set: { status: "running", updatedAt: ctx.now() },
    });
  const result = await runDiscovery(ctx, {
    source,
    mode: "backfill",
    options: { fromYear: input.year, toYear: input.year, grade: input.grade },
    metadata: { scope },
    artifacts: input.artifacts,
  });
  await ctx.db
    .update(ingestionCheckpoints)
    .set({
      status:
        result.status === "completed"
          ? "completed"
          : result.status === "locked"
            ? "running"
            : result.status,
      processedCount: result.counts.discovered,
      lastCursor: `${input.year}:${input.grade}`,
      updatedAt: ctx.now(),
    })
    .where(
      and(eq(ingestionCheckpoints.sourceId, source.id), eq(ingestionCheckpoints.scope, scope)),
    );
  return { source: source.id, scope, status: result.status, counts: result.counts };
}

/** 관리자 수동 재시도: 실패/사라진 자료를 다시 검증 */
export async function retryArtifact(ctx: IngestionContext, artifactId: string) {
  await ctx.db
    .update(sourceArtifacts)
    .set({ status: "discovered", statusReason: "manual retry", updatedAt: ctx.now() })
    .where(eq(sourceArtifacts.id, artifactId));
  await enqueueJob(ctx.db, {
    runAt: ctx.now(),
    type: "verify_artifact",
    payload: { artifactId, manual: true },
    dedupeKey: `manual-verify:${artifactId}:${ctx.now().getTime()}`,
  });
}

/** ready 자료를 주기적으로 다시 받아 SHA-256 비교 (같은 URL 내용 변경 감지) */
export async function queueRechecks(
  ctx: IngestionContext,
  olderThanDays = 7,
  limit = 30,
): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const stale = await ctx.db
    .select({ id: sourceArtifacts.id, sourceUrl: sourceArtifacts.sourceUrl })
    .from(sourceArtifacts)
    .where(
      and(inArray(sourceArtifacts.status, ["ready"]), lt(sourceArtifacts.lastCheckedAt, cutoff)),
    )
    .limit(limit);
  const day = ctx.now().toISOString().slice(0, 10);
  let queued = 0;
  for (const a of stale) {
    if (
      await enqueueJob(ctx.db, {
        runAt: ctx.now(),
        type: "verify_artifact",
        payload: { artifactId: a.id, recheck: true },
        dedupeKey: `recheck:${a.id}:${urlHash(a.sourceUrl)}:${day}`,
        maxAttempts: 3,
      })
    ) {
      queued += 1;
    }
  }
  return queued;
}

/** 최근 실패한 run 이 있는 source 확인용 */
export async function recentRuns(ctx: IngestionContext, sinceHours = 24) {
  return ctx.db
    .select()
    .from(ingestionRuns)
    .where(gte(ingestionRuns.startedAt, new Date(ctx.now().getTime() - sinceHours * 3600_000)))
    .orderBy(desc(ingestionRuns.startedAt));
}
