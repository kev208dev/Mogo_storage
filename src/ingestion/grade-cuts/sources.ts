import type { GradeCutSource } from "../../lib/constants";
import type { GradeCutEntry } from "../../lib/data/types";
import type { CanonicalExam } from "../types";
import type { AdapterStatus } from "./core";

/**
 * 등급컷 수집 정책. 공식/예상 구분은 grade_cuts.isOfficial 로 유지한다.
 *  - automated: 공개적으로 이용 가능한 공식 자료를 adapter 로 수집할 수 있음
 *  - manual_only: 자동 scraping 하지 않는다. (로그인/anti-bot/비공개 API/이용조건 문제)
 *                 운영자가 공개 자료를 확인해 수동 입력하는 source 로 남긴다.
 */
export type GradeCutCollectionPolicy = "automated" | "manual_only";

export interface GradeCutSourcePolicy {
  source: GradeCutSource;
  isOfficial: boolean;
  policy: GradeCutCollectionPolicy;
  note: string;
  status: AdapterStatus;
}

export const GRADE_CUT_SOURCE_POLICIES: Record<GradeCutSource, GradeCutSourcePolicy> = {
  official: {
    source: "official",
    isOfficial: true,
    policy: "manual_only",
    status: "disabled_unverified",
    note: "공식 채점 결과(등급 구분 점수)는 공개 자료로 확인해 입력. 공개 형식 확인 후 automated adapter 추가 가능",
  },
  ebs: {
    source: "ebs",
    isOfficial: false,
    policy: "manual_only",
    status: "disabled_policy",
    note: "예상 등급컷. 이용조건 확인 전 자동 수집하지 않음",
  },
  megastudy: {
    source: "megastudy",
    isOfficial: false,
    policy: "automated",
    status: "automated_verified",
    note: "공개 원점수 표만 자동 수집: 고3 사회·과학탐구, 고2 학력평가 국어·수학·탐구, 고1 학력평가 국어·수학 (그 외는 수동 보정)",
  },
  daesung: {
    source: "daesung",
    isOfficial: false,
    policy: "manual_only",
    status: "disabled_policy",
    note: "공개 시험분석 숫자 표는 확인했으나 robots.txt가 해당 경로를 Disallow하므로 자동 요청 금지",
  },
  jongro: { source: "jongro", isOfficial: false, policy: "automated", status: "automated_verified", note: "공개 추정/확정 등급컷 표; 공식값 아님" },
  etoos: { source: "etoos", isOfficial: false, policy: "manual_only", status: "manual_only", note: "공개 숫자 표 자동화 근거 부족" },
  jinhak: { source: "jinhak", isOfficial: false, policy: "manual_only", status: "blocked_challenge", note: "접근 challenge로 자동 수집 금지" },
  uway: { source: "uway", isOfficial: false, policy: "manual_only", status: "disabled_policy", note: "정책상 자동 수집 비활성" },
  kimyoungil: { source: "kimyoungil", isOfficial: false, policy: "manual_only", status: "research_pending", note: "공개 데이터 형식 조사 중" },
};

export interface CollectedGradeCut {
  source: GradeCutSource;
  subject: string;
  cuts: GradeCutEntry[];
  sourceUrl: string;
}

/** 공개 데이터를 자동 수집할 수 있는 source 만 구현한다 (현재 구현체 없음) */
export interface GradeCutSourceAdapter {
  readonly source: GradeCutSource;
  collect(exam: CanonicalExam): Promise<CollectedGradeCut[]>;
}

/**
 * 등급컷 수집 진입점. policy 가 automated 인 source 만 adapter 를 실행하고,
 * 나머지는 수동 입력 대상으로 돌려준다 (자동 수집하지 않음).
 */
export async function collectGradeCuts(
  exam: CanonicalExam,
  adapters: GradeCutSourceAdapter[] = [],
): Promise<{ collected: CollectedGradeCut[]; manual: GradeCutSource[] }> {
  const collected: CollectedGradeCut[] = [];
  const manual: GradeCutSource[] = [];
  for (const policy of Object.values(GRADE_CUT_SOURCE_POLICIES)) {
    const adapter = adapters.find((a) => a.source === policy.source);
    if (policy.policy !== "automated" || !adapter) {
      manual.push(policy.source);
      continue;
    }
    collected.push(...(await adapter.collect(exam)));
  }
  return { collected, manual };
}
