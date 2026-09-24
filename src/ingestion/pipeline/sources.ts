import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { examSources, sourcePriorities } from "../../db/schema";
import { EXAM_TYPES, type ExamType } from "../../lib/constants";
import type { SourceHealth, SourceConfig } from "../types";
import { BUILTIN_SOURCES, DEFAULT_SOURCE_PRIORITIES } from "../sources/config";
import { envEnabled } from "../sources/registry";

/**
 * 코드의 기본 source 설정을 DB 에 넣는다 (없을 때만). 운영자가 바꾼 값은 덮어쓰지 않는다.
 * allowedHosts/baseUrl 처럼 코드가 정답인 값만 갱신한다.
 */
export async function syncBuiltinSources(db: Database, sources: SourceConfig[] = BUILTIN_SOURCES) {
  for (const s of sources) {
    await db
      .insert(examSources)
      .values({
        id: s.id,
        kind: s.kind,
        name: s.name,
        baseUrl: s.baseUrl,
        allowedHosts: s.allowedHosts,
        deliveryPolicy: s.deliveryPolicy,
        enabled: s.enabled,
        minPollIntervalSeconds: s.minPollIntervalSeconds,
        requestTimeoutMs: s.requestTimeoutMs,
        maxConcurrentRequests: s.maxConcurrentRequests,
        minRequestGapMs: s.minRequestGapMs,
        maxRetries: s.maxRetries,
        healthStatus: s.enabled ? "healthy" : "disabled",
      })
      .onConflictDoUpdate({
        target: examSources.id,
        set: { baseUrl: s.baseUrl, allowedHosts: s.allowedHosts, updatedAt: new Date() },
      });
  }
  for (const examType of EXAM_TYPES) {
    const order = DEFAULT_SOURCE_PRIORITIES[examType];
    for (const [index, sourceId] of order.entries()) {
      if (!sources.some((s) => s.id === sourceId)) continue;
      await db
        .insert(sourcePriorities)
        .values({ examType, sourceId, priority: index + 1 })
        .onConflictDoNothing();
    }
  }
}

type SourceRow = typeof examSources.$inferSelect;

export function toSourceConfig(row: SourceRow, env: NodeJS.ProcessEnv = process.env): SourceConfig {
  // 환경변수 SOURCE_X_ENABLED=false 는 DB 설정보다 우선하는 비상 스위치
  const envFlag = envEnabled(row.id, env);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    allowedHosts: row.allowedHosts,
    deliveryPolicy: row.deliveryPolicy,
    enabled: envFlag === false ? false : row.enabled,
    minPollIntervalSeconds: row.minPollIntervalSeconds,
    requestTimeoutMs: row.requestTimeoutMs,
    maxConcurrentRequests: row.maxConcurrentRequests,
    minRequestGapMs: row.minRequestGapMs,
    maxRetries: row.maxRetries,
  };
}

export async function loadSources(db: Database): Promise<SourceConfig[]> {
  const rows = await db.select().from(examSources);
  return rows.map((r) => toSourceConfig(r));
}

export async function loadSource(db: Database, id: string): Promise<SourceConfig | null> {
  const [row] = await db.select().from(examSources).where(eq(examSources.id, id));
  return row ? toSourceConfig(row) : null;
}

/** 시험 유형별 source 우선순위 (DB 설정, 없으면 코드 기본값) */
export async function loadPriorities(db: Database, examType: ExamType): Promise<string[]> {
  const rows = await db
    .select()
    .from(sourcePriorities)
    .where(eq(sourcePriorities.examType, examType))
    .orderBy(sourcePriorities.priority);
  return rows.length ? rows.map((r) => r.sourceId) : DEFAULT_SOURCE_PRIORITIES[examType];
}

export async function recordFetchSuccess(db: Database, sourceId: string, now: Date) {
  await db
    .update(examSources)
    .set({
      lastSuccessfulFetchAt: now,
      failureCount: 0,
      healthStatus: sql`case when ${examSources.enabled} then 'healthy'::source_health_status else 'disabled'::source_health_status end`,
      healthMessage: null,
      updatedAt: now,
    })
    .where(eq(examSources.id, sourceId));
}

export async function recordFetchFailure(
  db: Database,
  sourceId: string,
  now: Date,
  status: "degraded" | "broken",
  message: string,
) {
  await db
    .update(examSources)
    .set({
      lastFailureAt: now,
      failureCount: sql`${examSources.failureCount} + 1`,
      healthStatus: status,
      healthMessage: message.slice(0, 500),
      updatedAt: now,
    })
    .where(eq(examSources.id, sourceId));
}

export async function recordHealthCheck(db: Database, sourceId: string, health: SourceHealth) {
  const now = new Date(health.checkedAt);
  await db
    .update(examSources)
    .set({
      lastHealthCheckAt: now,
      healthStatus: health.status,
      healthMessage: health.message.slice(0, 500),
      ...(health.status === "healthy" || health.status === "degraded"
        ? { lastSuccessfulFetchAt: now }
        : health.status === "broken"
          ? { lastFailureAt: now, failureCount: sql`${examSources.failureCount} + 1` }
          : {}),
      updatedAt: now,
    })
    .where(eq(examSources.id, sourceId));
}

export async function setSourceEnabled(db: Database, sourceId: string, enabled: boolean) {
  await db
    .update(examSources)
    .set({ enabled, healthStatus: enabled ? "healthy" : "disabled", updatedAt: new Date() })
    .where(and(eq(examSources.id, sourceId)));
}
