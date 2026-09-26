import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { examSources, sourcePriorities } from "../../db/schema";
import { EXAM_TYPES, type ExamType } from "../../lib/constants";
import { SOURCE_CAPABILITIES, type SourceCapability } from "../constants";
import type { SourceHealth, SourceConfig } from "../types";
import { BUILTIN_SOURCES, DEFAULT_SOURCE_PRIORITIES } from "../sources/config";
import { envEnabled } from "../sources/registry";
import { activationBlockers, currentParserVersion, isLiveVerified } from "../sources/verification";
import { isCapabilityPolicyBlocked, policyBlockers } from "../sources/policy";
import { IngestionError } from "../errors";
import { syncCourseCatalog } from "./course-aliases";

/**
 * 코드의 기본 source 설정을 DB 에 넣는다 (없을 때만). 운영자가 바꾼 값은 덮어쓰지 않는다.
 * allowedHosts/baseUrl 처럼 코드가 정답인 값만 갱신한다.
 */
export async function syncBuiltinSources(db: Database, sources: SourceConfig[] = BUILTIN_SOURCES) {
  await syncCourseCatalog(db);
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
        discoveryEnabled: s.capabilities.discovery,
        artifactEnabled: s.capabilities.artifacts,
        releaseWatchEnabled: s.capabilities.release_watch,
        healthStatus: s.enabled ? "healthy" : "unverified",
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
  // 환경변수 SOURCE_<ID>_ENABLED=true|false 가 있으면 DB 설정보다 우선 (비상 스위치). 비우면 DB 값
  const envFlag = envEnabled(row.id, env);
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.baseUrl,
    allowedHosts: row.allowedHosts,
    deliveryPolicy: row.deliveryPolicy,
    enabled: envFlag ?? row.enabled,
    liveVerified: isLiveVerified(row.kind, row),
    capabilities: {
      discovery: row.discoveryEnabled,
      artifacts: row.artifactEnabled,
      release_watch: row.releaseWatchEnabled,
    },
    healthStatus: row.healthStatus,
    lastHealthCheckAt: row.lastHealthCheckAt,
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
  status: "degraded" | "structure_changed" | "network_error",
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

/**
 * health check 결과 기록. 꺼져 있는 source 도 실제 결과를 기록한다 (켜기 전 "health check 통과" 조건).
 */
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
        : health.status === "structure_changed" || health.status === "network_error"
          ? { lastFailureAt: now, failureCount: sql`${examSources.failureCount} + 1` }
          : {}),
      updatedAt: now,
    })
    .where(eq(examSources.id, sourceId));
}

/**
 * source 켜기/끄기 (master switch). 켜려면 activationBlockers 가 비어 있어야 한다:
 * live fixture 검증 · 현재 parser 일치 · 관리자 승인 · 최근 health check 통과.
 * 켠 뒤에도 기능(discovery/artifacts/release_watch)은 따로 단계적으로 켠다.
 */
export async function setSourceEnabled(
  db: Database,
  sourceId: string,
  enabled: boolean,
  now = new Date(),
) {
  const [row] = await db.select().from(examSources).where(eq(examSources.id, sourceId));
  if (!row) throw new IngestionError("NOT_FOUND", `source ${sourceId} not found`);
  if (enabled) {
    const blockers = [...policyBlockers(row.id), ...activationBlockers(row, now)];
    if (blockers.length) {
      throw new IngestionError(
        "SOURCE_NOT_VERIFIED",
        `${row.name}: 켤 수 없습니다 — ${blockers.join(", ")} (parser ${currentParserVersion(row.kind) ?? "?"}).`,
      );
    }
  }
  await db
    .update(examSources)
    .set(
      enabled
        ? { enabled: true, updatedAt: now }
        : {
            enabled: false,
            discoveryEnabled: false,
            artifactEnabled: false,
            releaseWatchEnabled: false,
            updatedAt: now,
          },
    )
    .where(and(eq(examSources.id, sourceId)));
}

const CAPABILITY_COLUMN = {
  discovery: "discoveryEnabled",
  artifacts: "artifactEnabled",
  release_watch: "releaseWatchEnabled",
} as const;

/**
 * 기능 단위 활성화. 순서: discovery → artifacts → release_watch (앞 단계가 켜져 있어야 다음을 켤 수 있다).
 * 끄면 뒤 단계도 함께 꺼진다.
 */
export async function setSourceCapability(
  db: Database,
  sourceId: string,
  capability: SourceCapability,
  on: boolean,
  now = new Date(),
) {
  const [row] = await db.select().from(examSources).where(eq(examSources.id, sourceId));
  if (!row) throw new IngestionError("NOT_FOUND", `source ${sourceId} not found`);
  if (on && isCapabilityPolicyBlocked(row.id, capability))
    throw new IngestionError(
      "SOURCE_NOT_VERIFIED",
      `${row.name}: ${capability} 는 정책상 자동화할 수 없습니다 (robots/이용조건 — docs/SOURCE_SURVEY.md).`,
    );
  if (on) {
    if (!row.enabled || !isLiveVerified(row.kind, row)) {
      throw new IngestionError(
        "SOURCE_NOT_ENABLED",
        `${row.name}: 검증·승인 후 source 를 먼저 켜야 합니다.`,
      );
    }
    if (capability === "artifacts" && !row.discoveryEnabled)
      throw new IngestionError("CAPABILITY_ORDER", "시험 metadata 수집(discovery)을 먼저 켜세요.");
    if (capability === "release_watch" && !row.artifactEnabled)
      throw new IngestionError("CAPABILITY_ORDER", "자료 수집(artifacts)을 먼저 켜세요.");
  }
  const index = SOURCE_CAPABILITIES.indexOf(capability);
  const set: Partial<Record<(typeof CAPABILITY_COLUMN)[SourceCapability], boolean>> = {};
  if (on) set[CAPABILITY_COLUMN[capability]] = true;
  else for (const c of SOURCE_CAPABILITIES.slice(index)) set[CAPABILITY_COLUMN[c]] = false;
  await db
    .update(examSources)
    .set({ ...set, updatedAt: now })
    .where(eq(examSources.id, sourceId));
}

/** CLI 가 실제 fixture 로 contract 검증을 통과했을 때 남기는 증거 (승인은 아님) */
export async function recordLiveFixtureEvidence(
  db: Database,
  sourceId: string,
  evidence: { passed: boolean; fixtureHash: string | null; parserVersion: string | null; at: Date },
) {
  await db
    .update(examSources)
    .set(
      evidence.passed
        ? {
            liveFixtureValidatedAt: evidence.at,
            liveFixtureHash: evidence.fixtureHash,
            liveFixtureParserVersion: evidence.parserVersion,
            updatedAt: evidence.at,
          }
        : {
            // 실제 fixture 에서 contract 가 깨졌다 → 증거와 승인을 모두 무효화하고 수집을 멈춘다
            liveFixtureValidatedAt: null,
            liveFixtureHash: null,
            liveFixtureParserVersion: null,
            verifiedAgainstLiveFixture: false,
            enabled: false,
            discoveryEnabled: false,
            artifactEnabled: false,
            releaseWatchEnabled: false,
            healthStatus: "structure_changed",
            healthMessage: "live fixture contract failed (구조 변경 가능성)",
            updatedAt: evidence.at,
          },
    )
    .where(eq(examSources.id, sourceId));
}

/**
 * 관리자 승인: 현재 parser 버전으로 live fixture 검증을 통과한 증거가 있어야 한다.
 * 승인 후에도 source 를 켜는 것은 별도 작업이다.
 */
export async function approveLiveVerification(
  db: Database,
  sourceId: string,
  admin: string,
  now = new Date(),
) {
  const [row] = await db.select().from(examSources).where(eq(examSources.id, sourceId));
  if (!row) throw new IngestionError("NOT_FOUND", `source ${sourceId} not found`);
  const current = currentParserVersion(row.kind);
  if (!row.liveFixtureValidatedAt || !row.liveFixtureHash) {
    throw new IngestionError(
      "NO_EVIDENCE",
      "실제 페이지 fixture 검증 기록이 없습니다. npm run ingest:fixtures:validate -- --record 를 먼저 실행하세요.",
    );
  }
  if (row.liveFixtureParserVersion !== current) {
    throw new IngestionError(
      "STALE_EVIDENCE",
      `fixture 검증은 parser ${row.liveFixtureParserVersion} 기준입니다. 현재 ${current} 로 다시 검증하세요.`,
    );
  }
  await db
    .update(examSources)
    .set({
      verifiedAgainstLiveFixture: true,
      verifiedAt: now,
      verifiedBy: admin,
      verifiedFixtureHash: row.liveFixtureHash,
      verifiedParserVersion: current,
      updatedAt: now,
    })
    .where(eq(examSources.id, sourceId));
}

export async function revokeLiveVerification(db: Database, sourceId: string) {
  await db
    .update(examSources)
    .set({
      verifiedAgainstLiveFixture: false,
      enabled: false,
      discoveryEnabled: false,
      artifactEnabled: false,
      releaseWatchEnabled: false,
      healthStatus: "unverified",
      updatedAt: new Date(),
    })
    .where(eq(examSources.id, sourceId));
}
