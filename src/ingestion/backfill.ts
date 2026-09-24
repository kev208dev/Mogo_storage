import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { ingestionCheckpoints, ingestionRuns, sourceArtifacts } from "../db/schema";
import { GRADES, type Grade } from "../lib/constants";
import type { IngestionContext } from "./context";
import { enqueueJob } from "./jobs/queue";
import { runJobs } from "./jobs/worker";
import { urlHash } from "./pipeline/artifacts";
import { runDiscovery, type DiscoveryResult } from "./pipeline/discovery";
import { loadSources } from "./pipeline/sources";
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
}

export interface BackfillScopeResult {
  source: string;
  scope: string;
  status: "done" | "skipped_checkpoint" | DiscoveryResult["status"];
  counts?: DiscoveryResult["counts"];
}

/**
 * BACKFILL: 과거 시험을 (source, 연도, 학년) 범위 단위로 수집한다.
 * 범위마다 checkpoint 를 남겨, 중간에 실패해도 다시 실행하면 완료된 범위를 건너뛴다.
 * 이미 있는 시험/자료는 update/skip 되며 중복 생성되지 않는다.
 */
export async function runBackfill(ctx: IngestionContext, options: BackfillOptions) {
  const sources = (await loadSources(ctx.db)).filter((s) =>
    options.sourceIds?.length ? options.sourceIds.includes(s.id) : s.enabled,
  );
  const grades = options.grades?.length ? options.grades : [...GRADES];
  const results: BackfillScopeResult[] = [];
  for (const source of sources) {
    for (let year = options.toYear; year >= options.fromYear; year -= 1) {
      for (const grade of grades) {
        const scope = `backfill:${year}:high${grade}`;
        results.push(
          await backfillScope(ctx, source, scope, { year, grade, force: options.force }),
        );
      }
    }
  }
  const jobs =
    options.runJobs === false
      ? null
      : await runJobs(ctx, { timeBudgetMs: options.jobTimeBudgetMs ?? 120_000, limit: 1000 });
  return { results, jobs };
}

async function backfillScope(
  ctx: IngestionContext,
  source: SourceConfig,
  scope: string,
  input: { year: number; grade: Grade; force?: boolean },
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
