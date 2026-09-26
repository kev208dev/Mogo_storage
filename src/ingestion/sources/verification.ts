import parserVersions from "./parser-versions.json";
import type { SourceCapability, SourceHealthStatus } from "../constants";
import type { SourceConfig } from "../types";
import { isCapabilityPolicyBlocked } from "./policy";

/**
 * 현재 코드의 parser 버전. parser 관련 파일이 바뀌면 버전이 바뀌고(단위 테스트가 강제),
 * 이전 버전으로 받은 live 검증은 더 이상 유효하지 않다.
 */
export function currentParserVersion(kind: string): string | null {
  const entry = (parserVersions as Record<string, { version: string; hash: string }>)[kind];
  return entry?.version ?? null;
}

export interface VerificationState {
  verifiedAgainstLiveFixture: boolean;
  verifiedParserVersion: string | null;
}

/** 실제 페이지 fixture 로 검증·승인된 상태이고, 그 뒤로 parser 가 바뀌지 않았는지 */
export function isLiveVerified(kind: string, state: VerificationState): boolean {
  const current = currentParserVersion(kind);
  return Boolean(
    state.verifiedAgainstLiveFixture && current && state.verifiedParserVersion === current,
  );
}

/**
 * 자동 수집 허용 조건: enabled AND 실제 fixture 검증 완료.
 * 환경변수만으로는 우회할 수 없다 (검증 상태는 DB 에 있고, 관리자 승인이 필요하다).
 */
export function canIngest(source: Pick<SourceConfig, "enabled" | "liveVerified">): boolean {
  return source.enabled && source.liveVerified;
}

/** 구조가 바뀐 것으로 보이는 상태에서는 어떤 기능도 실행하지 않는다 (사람이 확인할 때까지) */
const STOPPED: SourceHealthStatus[] = ["structure_changed", "broken", "unverified"];

/**
 * 기능 단위 실행 조건: enabled AND live 검증 AND 구조 변경 상태 아님 AND 해당 기능이 켜져 있음.
 * release_watch 는 artifacts 가, artifacts 는 discovery 가 켜져 있어야 한다 (단계적 활성화).
 * options.allowUnverified 는 테스트/로컬 fake source 전용 (코드에서만 설정, 환경변수 없음).
 */
export function canRun(
  source: Pick<SourceConfig, "enabled" | "liveVerified" | "capabilities" | "healthStatus"> & {
    id?: string;
  },
  capability: SourceCapability,
  options: { allowUnverified?: boolean } = {},
): boolean {
  if (!source.enabled) return false;
  if (!options.allowUnverified) {
    // robots·이용조건상 금지된 기능은 DB 설정과 무관하게 실행하지 않는다 (sources/policy.ts)
    if (source.id && isCapabilityPolicyBlocked(source.id, capability)) return false;
    if (!source.liveVerified) return false;
    if (source.healthStatus && STOPPED.includes(source.healthStatus)) return false;
  }
  const c = source.capabilities;
  if (capability === "discovery") return c.discovery;
  if (capability === "artifacts") return c.discovery && c.artifacts;
  return c.discovery && c.artifacts && c.release_watch;
}

/** health check 결과가 이보다 오래되면 활성화 조건으로 인정하지 않는다 */
export const HEALTH_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ActivationState extends VerificationState {
  kind: string;
  liveFixtureValidatedAt: Date | null;
  liveFixtureParserVersion: string | null;
  healthStatus: SourceHealthStatus;
  lastHealthCheckAt: Date | null;
}

/**
 * production 활성화 전 조건 (하나라도 빠지면 켤 수 없다):
 *  1. live fixture 존재 + fixture validation 통과 (증거 기록)
 *  2. 현재 parserVersion 과 fixture parserVersion 일치
 *  3. 관리자 승인
 *  4. 최근 health check 통과
 * 빈 배열이면 활성화 가능.
 */
export function activationBlockers(row: ActivationState, now = new Date()): string[] {
  const blockers: string[] = [];
  const current = currentParserVersion(row.kind);
  if (!row.liveFixtureValidatedAt) blockers.push("live fixture 검증 기록 없음");
  else if (row.liveFixtureParserVersion !== current)
    blockers.push(`fixture 검증이 이전 parser(${row.liveFixtureParserVersion}) 기준`);
  if (!isLiveVerified(row.kind, row)) blockers.push("관리자 검증 승인 없음 (또는 parser 변경)");
  if (
    !row.lastHealthCheckAt ||
    now.getTime() - row.lastHealthCheckAt.getTime() > HEALTH_CHECK_MAX_AGE_MS
  )
    blockers.push("최근 24시간 health check 없음");
  else if (row.healthStatus !== "healthy") blockers.push(`health check 결과 ${row.healthStatus}`);
  return blockers;
}
