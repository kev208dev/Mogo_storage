import type { GradeCutSource } from "../../lib/constants";

export const GRADE_CUT_PROVIDERS = [
  "megastudy",
  "ebsi",
  "daesung",
  "etoos",
  "jongro",
  "jinhak",
  "uway",
  "kimyoungil",
] as const;
export type GradeCutProvider = (typeof GRADE_CUT_PROVIDERS)[number];
export type ProviderAutomationStatus =
  | "automated_first_party"
  | "automated_secondary"
  | "manual_verified"
  | "blocked_policy"
  | "blocked_challenge"
  | "research_pending"
  | "manual_only"
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

export const GRADE_CUT_PROVIDER_POLICIES: Record<GradeCutProvider, GradeCutProviderPolicy> = {
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
    reason: "robots 정책상 자동 요청 비활성",
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
    automation: "manual_only",
    firstParty: true,
    reason: "수동 확인 경로만 사용",
  },
  jongro: {
    provider: "jongro",
    source: "jongro",
    automation: "automated_first_party",
    firstParty: true,
    reason: "robots 허용된 공개 등급컷 페이지를 자동 수집",
  },
  jinhak: {
    provider: "jinhak",
    source: null,
    automation: "blocked_challenge",
    firstParty: true,
    reason: "공개 경로에서 challenge 확인, 자동 수집 비활성",
  },
  uway: {
    provider: "uway",
    source: null,
    automation: "blocked_policy",
    firstParty: true,
    reason: "정책상 자동 수집 비활성",
  },
  kimyoungil: {
    provider: "kimyoungil",
    source: "kimyoungil",
    automation: "research_pending",
    firstParty: true,
    reason: "공개 등급컷 데이터와 이용 정책 조사 중",
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
