import type { ExamType } from "../../lib/constants";
import type { SourceConfig } from "../types";

/**
 * 코드에 정의된 공식 출처 기본 설정. `npm run ingest:sources` 가 exam_sources 테이블에 동기화한다.
 * (DB 에서 운영자가 바꾼 enabled/정책 값은 동기화 시 덮어쓰지 않는다)
 *
 * ⚠️ deliveryPolicy 기본값은 모두 source_redirect.
 *    각 기관의 이용조건에서 재배포 허용이 확인된 경우에만 mirror_allowed 로 바꾼다.
 * ⚠️ enabled 기본값은 false. parser 를 실제 페이지로 검증(npm run ingest:health)한 뒤 켠다.
 */
export const BUILTIN_SOURCES: SourceConfig[] = [
  {
    id: "kice",
    kind: "kice",
    name: "한국교육과정평가원",
    baseUrl: "https://www.suneung.re.kr",
    allowedHosts: ["www.suneung.re.kr", "suneung.re.kr", "www.kice.re.kr"],
    deliveryPolicy: "source_redirect",
    enabled: false,
    liveVerified: false,
    minPollIntervalSeconds: 600,
    requestTimeoutMs: 20_000,
    maxConcurrentRequests: 1,
    minRequestGapMs: 2_000,
    maxRetries: 2,
  },
  {
    id: "ebsi",
    kind: "ebsi",
    name: "EBSi",
    baseUrl: "https://www.ebsi.co.kr",
    allowedHosts: ["www.ebsi.co.kr", "wdown.ebsi.co.kr"],
    deliveryPolicy: "source_redirect",
    enabled: false,
    liveVerified: false,
    minPollIntervalSeconds: 300,
    requestTimeoutMs: 15_000,
    maxConcurrentRequests: 2,
    minRequestGapMs: 1_500,
    maxRetries: 2,
  },
  {
    id: "education_office",
    kind: "education_office",
    name: "시·도 교육청",
    baseUrl: "https://www.sen.go.kr",
    allowedHosts: ["www.sen.go.kr"],
    deliveryPolicy: "source_redirect",
    enabled: false,
    liveVerified: false,
    minPollIntervalSeconds: 900,
    requestTimeoutMs: 20_000,
    maxConcurrentRequests: 1,
    minRequestGapMs: 3_000,
    maxRetries: 2,
  },
];

/**
 * 시험 유형별 source 우선순위 (원본성/신뢰도 기준이며 서비스 평가가 아니다).
 * 평가원 시험은 평가원 자료가 원본, 학력평가는 교육청(출제 기관) 다음 EBSi.
 */
export const DEFAULT_SOURCE_PRIORITIES: Record<ExamType, string[]> = {
  kice_mock: ["kice", "ebsi", "education_office"],
  csat: ["kice", "ebsi", "education_office"],
  school_mock: ["education_office", "ebsi", "kice"],
};

/** 우선순위가 높은 순으로 정렬. 목록에 없는 source 는 뒤로 */
export function rankSources(sourceIds: string[], priorities: string[]): string[] {
  const rank = (id: string) => {
    const i = priorities.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...sourceIds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function userAgent(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://github.com/kev208dev/Mogo_storage";
  return `MogoStorageBot/1.0 (+${site})`;
}
