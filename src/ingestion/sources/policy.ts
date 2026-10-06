import type { SourceCapability, SourceHealthStatus } from "../constants";
import type { AdapterStatus } from "../grade-cuts/core";
import { GRADE_CUT_SOURCE_POLICIES } from "../grade-cuts/sources";
import type { SourceConfig } from "../types";

/**
 * source × 기능 단위 자동화 정책.
 *
 * 한 source 가 일부 기능만 지원할 수 있다 (예: EBSi 파일 서버는 robots 가 없지만 목록은 robots 가 막는다).
 * 여기 적은 정책은 코드로 강제된다: policy_blocked 인 기능은 관리자가 capability 를 켜도 실행되지 않는다.
 * robots/이용조건이 바뀌면 근거(evidence)를 새로 확인해 이 표를 고친다 — 우회 구현은 하지 않는다.
 */
export const SOURCE_FEATURES = [
  "discover_exams",
  "discover_files",
  "fetch_file",
  "release_watch",
  "grade_cuts",
] as const;
export type SourceFeature = (typeof SOURCE_FEATURES)[number];

export const FEATURE_LABELS: Record<SourceFeature, string> = {
  discover_exams: "시험 발견",
  discover_files: "파일 발견",
  fetch_file: "파일 검증 요청",
  release_watch: "시험일 감시",
  grade_cuts: "등급컷",
};

export interface PolicyEvidence {
  /** 확인한 날 (YYYY-MM-DD) */
  checkedAt: string;
  /** 근거 URL (robots.txt 등) */
  url: string;
  /** 확인한 내용 */
  finding: string;
}

export type FeatureSupport =
  /** 구현된 adapter. 실행 여부는 enabled · live 검증 · health · capability 로 결정 */
  | { kind: "adapter"; capability: SourceCapability; note?: string }
  /** robots · 이용조건 · anti-bot 때문에 자동 요청 금지 */
  | { kind: "policy_blocked"; reason: string; evidence: PolicyEvidence }
  /** 운영자 확인 흐름으로만 처리 */
  | { kind: "manual"; reason: string }
  | { kind: "not_applicable" };

const EBSI_ROBOTS: PolicyEvidence = {
  checkedAt: "2026-10-06",
  url: "https://www.ebsi.co.kr/robots.txt",
  finding: "Disallow: /*.ajax$ — 기출 archive 목록은 .ajax 응답으로만 제공된다",
};
const KICE_ROBOTS: PolicyEvidence = {
  checkedAt: "2026-09-25",
  url: "https://www.suneung.re.kr/robots.txt",
  finding: "User-agent: * / Disallow: / (사이트 전체)",
};
const SEN_POLICY: PolicyEvidence = {
  checkedAt: "2026-09-25",
  url: "https://www.sen.go.kr/robots.txt",
  finding:
    "접속 대기열(NetFunnel) anti-bot + pdf·hwp Disallow. 다른 교육청은 robots 허용 자료실 미확인",
};

export const SOURCE_FEATURE_POLICIES: Record<
  string,
  Partial<Record<SourceFeature, FeatureSupport>>
> = {
  ebsi: {
    discover_exams: {
      kind: "policy_blocked",
      reason: "robots 가 archive(.ajax)를 금지",
      evidence: EBSI_ROBOTS,
    },
    discover_files: {
      kind: "policy_blocked",
      reason: "robots 가 archive(.ajax)를 금지",
      evidence: EBSI_ROBOTS,
    },
    fetch_file: {
      kind: "adapter",
      capability: "artifacts",
      note: "파일 서버 wdown.ebsi.co.kr 는 robots.txt 없음(404) — SafeFetcher 로 존재·형식만 확인",
    },
    release_watch: {
      kind: "policy_blocked",
      reason: "목록 확인이 .ajax 에 의존",
      evidence: EBSI_ROBOTS,
    },
  },
  kice: {
    discover_exams: {
      kind: "policy_blocked",
      reason: "robots 가 사이트 전체 금지",
      evidence: KICE_ROBOTS,
    },
    discover_files: {
      kind: "policy_blocked",
      reason: "robots 가 사이트 전체 금지",
      evidence: KICE_ROBOTS,
    },
    fetch_file: {
      kind: "policy_blocked",
      reason: "robots 가 사이트 전체 금지",
      evidence: KICE_ROBOTS,
    },
    release_watch: {
      kind: "policy_blocked",
      reason: "robots 가 사이트 전체 금지",
      evidence: KICE_ROBOTS,
    },
  },
  education_office: {
    discover_exams: {
      kind: "policy_blocked",
      reason: "anti-bot 대기열 · 허용 자료실 없음",
      evidence: SEN_POLICY,
    },
    discover_files: {
      kind: "policy_blocked",
      reason: "anti-bot 대기열 · 허용 자료실 없음",
      evidence: SEN_POLICY,
    },
    fetch_file: { kind: "policy_blocked", reason: "robots 가 pdf·hwp 금지", evidence: SEN_POLICY },
    release_watch: {
      kind: "policy_blocked",
      reason: "anti-bot 대기열 · 허용 자료실 없음",
      evidence: SEN_POLICY,
    },
  },
  operator_import: {
    discover_exams: {
      kind: "manual",
      reason: "운영자가 브라우저로 확인한 공식 URL 을 CSV 로 입력",
    },
    discover_files: {
      kind: "manual",
      reason: "운영자가 브라우저로 확인한 공식 URL 을 CSV 로 입력",
    },
    fetch_file: {
      kind: "manual",
      reason: "서버는 입력된 URL 에 요청하지 않는다 — 관리자 브라우저 확인 후 승인",
    },
    release_watch: { kind: "not_applicable" },
  },
};

/** 정책 표는 source id 기준. 모르는 source 는 "구현 안 됨" 으로 본다 */
export function featureSupport(sourceId: string, feature: SourceFeature): FeatureSupport {
  return SOURCE_FEATURE_POLICIES[sourceId]?.[feature] ?? { kind: "not_applicable" };
}

/** pipeline capability 가 어떤 정책 기능에 해당하는가 */
const CAPABILITY_FEATURES: Record<SourceCapability, SourceFeature[]> = {
  discovery: ["discover_exams"],
  artifacts: ["discover_files"],
  release_watch: ["release_watch"],
};

/** 이 source 의 이 capability 가 정책상 금지인가 (정책 표에 없는 source 는 금지가 아님 — 테스트용 fake 등) */
export function isCapabilityPolicyBlocked(sourceId: string, capability: SourceCapability): boolean {
  return CAPABILITY_FEATURES[capability].some(
    (f) => featureSupport(sourceId, f).kind === "policy_blocked",
  );
}

/** source 를 켤 수 없는 정책상 이유 (source 활성화 전 확인). 빈 배열이면 정책상 문제 없음 */
export function policyBlockers(sourceId: string): string[] {
  const discovery = featureSupport(sourceId, "discover_exams");
  if (discovery.kind === "policy_blocked")
    return [
      `정책상 자동 수집 금지: ${discovery.reason} (${discovery.evidence.url}, ${discovery.evidence.checkedAt} 확인)`,
    ];
  if (discovery.kind === "manual") return [`수동 전용 source: ${discovery.reason}`];
  return [];
}

export type FeatureStatus = AdapterStatus | "not_applicable";

const DEGRADED: SourceHealthStatus[] = ["degraded", "network_error"];
const STOPPED: SourceHealthStatus[] = ["structure_changed", "broken", "unverified"];

/**
 * 기능 단위 자동화 상태.
 *  - disabled_policy: robots/이용조건 때문에 금지 (코드로 막힘)
 *  - manual_only: 운영자 확인 흐름
 *  - automated_verified: 구현 + live 검증 + 켜짐 + 정상
 *  - degraded: 켜져 있으나 health 가 나쁨(네트워크 오류·부분 실패·구조 변경 의심)
 *  - disabled_unverified: 구현은 있으나 검증·활성화 전
 */
export function featureStatus(
  sourceId: string,
  feature: SourceFeature,
  runtime?: Pick<SourceConfig, "enabled" | "liveVerified" | "capabilities" | "healthStatus">,
): FeatureStatus {
  const support = featureSupport(sourceId, feature);
  if (support.kind === "policy_blocked") return "disabled_policy";
  if (support.kind === "manual") return "manual_only";
  if (support.kind === "not_applicable") return "not_applicable";
  if (
    !runtime ||
    !runtime.enabled ||
    !runtime.liveVerified ||
    !runtime.capabilities[support.capability]
  )
    return "disabled_unverified";
  if (
    runtime.healthStatus &&
    (DEGRADED.includes(runtime.healthStatus) || STOPPED.includes(runtime.healthStatus))
  )
    return "degraded";
  return "automated_verified";
}

export interface SourceStatusRow {
  source: string;
  name: string;
  features: Record<SourceFeature, FeatureStatus>;
  notes: string[];
}

/** 시험자료 source + 등급컷 source 를 한 표로 (관리자 화면 · CLI · 문서용) */
export function sourceStatusMatrix(runtime: SourceConfig[]): SourceStatusRow[] {
  const rows: SourceStatusRow[] = [];
  const byId = new Map(runtime.map((s) => [s.id, s]));
  for (const kind of Object.keys(SOURCE_FEATURE_POLICIES)) {
    const r = byId.get(kind);
    const features = Object.fromEntries(
      SOURCE_FEATURES.map((f) => [
        f,
        f === "grade_cuts" ? "not_applicable" : featureStatus(kind, f, r),
      ]),
    ) as Record<SourceFeature, FeatureStatus>;
    const notes = SOURCE_FEATURES.flatMap((f) => {
      const s = featureSupport(kind, f);
      if (s.kind === "policy_blocked") return [`${FEATURE_LABELS[f]}: ${s.reason}`];
      if (s.kind === "adapter" && s.note) return [`${FEATURE_LABELS[f]}: ${s.note}`];
      return [];
    });
    rows.push({ source: kind, name: r?.name ?? kind, features, notes: [...new Set(notes)] });
  }
  for (const p of Object.values(GRADE_CUT_SOURCE_POLICIES)) {
    const features = Object.fromEntries(
      SOURCE_FEATURES.map((f) => [f, f === "grade_cuts" ? p.status : "not_applicable"]),
    ) as Record<SourceFeature, FeatureStatus>;
    rows.push({
      source: `grade_cut:${p.source}`,
      name: `등급컷 ${p.source}`,
      features,
      notes: [p.note],
    });
  }
  return rows;
}
