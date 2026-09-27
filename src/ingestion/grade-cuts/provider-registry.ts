import type { GradeCutSource } from "../../lib/constants";

export const GRADE_CUT_PROVIDERS = [
  "megastudy",
  "ebsi",
  "daesung",
  "etoos",
  "jongro",
  "jinhak",
  "uway",
] as const;
export type GradeCutProvider = (typeof GRADE_CUT_PROVIDERS)[number];
export type ProviderAutomationStatus =
  | "automated_first_party"
  | "automated_secondary"
  | "manual_verified"
  | "blocked_policy"
  | "unsupported"
  | "no_data";
export type ProviderDataStatus = "estimated" | "finalized" | "missing" | "stale";

export interface GradeCutProvenance {
  provider: GradeCutProvider;
  sourceUrl: string;
  firstParty: boolean;
  observedVia: GradeCutProvider;
  observedAt: string;
  isOfficial: false;
  status: ProviderDataStatus;
}

export interface GradeCutProviderPolicy {
  provider: GradeCutProvider;
  source: GradeCutSource | null;
  automation: ProviderAutomationStatus;
  firstParty: boolean;
  reason: string;
}

export const GRADE_CUT_PROVIDER_POLICIES: Record<
  GradeCutProvider,
  GradeCutProviderPolicy
> = {
  megastudy: {
    provider: "megastudy",
    source: "megastudy",
    automation: "automated_first_party",
    firstParty: true,
    reason: "로그인 없이 공개되고 robots가 허용한 원점수 표만 자동 수집",
  },
  ebsi: {
    provider: "ebsi",
    source: "ebs",
    automation: "blocked_policy",
    firstParty: true,
    reason: "점수 데이터가 robots.txt에서 차단한 .ajax 경로에 있어 자동 요청 금지",
  },
  daesung: {
    provider: "daesung",
    source: "daesung",
    automation: "blocked_policy",
    firstParty: true,
    reason: "공개 표는 확인했지만 robots.txt가 /hmockTest/ 경로를 허용하지 않음",
  },
  etoos: {
    provider: "etoos",
    source: null,
    automation: "unsupported",
    firstParty: true,
    reason: "로그인 없이 안정적으로 검증 가능한 공개 숫자 표와 fixture 미확보",
  },
  jongro: {
    provider: "jongro",
    source: null,
    automation: "manual_verified",
    firstParty: true,
    reason: "공개 발표 페이지는 있으나 시험 식별자와 최소 fixture 검증 전 자동화하지 않음",
  },
  jinhak: {
    provider: "jinhak",
    source: null,
    automation: "unsupported",
    firstParty: true,
    reason: "자체 값과 비교표 값을 구분할 안정적인 공개 parser/fixture 미확보",
  },
  uway: {
    provider: "uway",
    source: null,
    automation: "no_data",
    firstParty: true,
    reason: "공개 안내에서 등급컷 서비스는 확인했지만 수집 가능한 숫자 표 미확보",
  },
};

export function assertProviderProvenance(value: GradeCutProvenance): void {
  if (value.isOfficial) throw new Error("private provider data cannot be official");
  if (!/^https:\/\//.test(value.sourceUrl)) throw new Error("sourceUrl must be https");
  if (value.firstParty && value.provider !== value.observedVia)
    throw new Error("first-party observation must be observed via the provider");
  if (!value.firstParty && value.provider === value.observedVia)
    throw new Error("secondary observation must name its aggregator");
  if (!Number.isFinite(Date.parse(value.observedAt))) throw new Error("invalid observedAt");
}
