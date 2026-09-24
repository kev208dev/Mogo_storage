import parserVersions from "./parser-versions.json";
import type { SourceConfig } from "../types";

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
