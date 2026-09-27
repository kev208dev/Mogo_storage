import type { GradeCutSource, Subject } from "../../lib/constants";
import type { GradeCutEntry } from "../../lib/data/types";
import { isHostAllowed } from "../net/url-policy";
import { cutsFingerprint, examEndAt, normalizeCuts, type WatchExam } from "./core";

/**
 * 등급컷 값 검증. adapter 수집값 · 관리자 입력 · 저장 직전 모두 같은 규칙을 쓴다.
 * 확실하지 않으면 저장하지 않는다 (예상치를 만들거나 보정하지 않음).
 */

/** 영역별 원점수 만점. 탐구·직업·제2외국어·한국사는 50점, 국어·수학·영어는 100점. */
export function maxRawScore(subject: Subject): number {
  return subject === "korean" || subject === "math" || subject === "english" ? 100 : 50;
}

/**
 * source 별 출처 URL 호스트. 공식(official) 여부는 텍스트("확정 등급컷")가 아니라
 * 출처 URL 이 공식 채점 기관 도메인인지(provenance)로만 정한다. EBS 는 예상 등급컷이므로 공식이 아니다.
 */
export const GRADE_CUT_SOURCE_HOSTS: Record<GradeCutSource, readonly string[]> = {
  official: [
    ".kice.re.kr",
    ".suneung.re.kr",
    ".sen.go.kr",
    ".goe.go.kr",
    ".ice.go.kr",
    ".pen.go.kr",
    ".dge.go.kr",
    ".gen.go.kr",
    ".dje.go.kr",
    ".use.go.kr",
    ".sje.go.kr",
    ".gwe.go.kr",
    ".cbe.go.kr",
    ".cne.go.kr",
    ".jbe.go.kr",
    ".jne.go.kr",
    ".gbe.kr",
    ".gne.go.kr",
    ".jje.go.kr",
  ],
  megastudy: [".megastudy.net"],
  daesung: [".mimacstudy.com"],
  ebs: [".ebsi.co.kr", ".ebs.co.kr"],
};

export type CutProblem =
  | "malformed"
  | "over_max"
  | "zero_top_grade"
  | "bad_source_url"
  | "source_host_mismatch"
  | "bad_observed_at";

export class GradeCutInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradeCutInputError";
  }
}

/** 관리자 화면에는 입력 오류와 같은 방식으로 메시지를 보여준다 */
export class GradeCutValidationError extends GradeCutInputError {
  constructor(
    readonly problem: CutProblem,
    message: string,
  ) {
    super(message);
    this.name = "GradeCutValidationError";
  }
}

/**
 * 출처 URL: https, 인증정보 없음. official 은 항상 공식 도메인이어야 한다.
 * 예상 등급컷은 자동 수집값(strictHost)만 source 도메인을 강제한다 — 관리자 수동 입력은 기사 등 다른 공개 출처를 인용할 수 있다.
 */
export function checkSourceUrl(
  source: GradeCutSource,
  sourceUrl: string,
  { strictHost = source === "official" }: { strictHost?: boolean } = {},
): URL {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new GradeCutValidationError("bad_source_url", "출처 URL 형식이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new GradeCutValidationError(
      "bad_source_url",
      "출처 URL은 인증정보 없는 HTTPS 주소여야 합니다.",
    );
  if (
    (strictHost || source === "official") &&
    !isHostAllowed(url.hostname, [...GRADE_CUT_SOURCE_HOSTS[source]])
  )
    throw new GradeCutValidationError(
      "source_host_mismatch",
      source === "official"
        ? `공식 등급컷은 평가원·교육청 도메인 출처만 인정합니다 (${url.hostname}).`
        : `${source} 등급컷의 출처 도메인이 아닙니다 (${url.hostname}).`,
    );
  return url;
}

/** 컷 값: 1~9등급 · 중복 없음 · 단조 감소 · 0~만점 · 1등급 컷은 0 이 아님 */
export function checkCuts(subject: Subject, cuts: GradeCutEntry[]): GradeCutEntry[] {
  let normalized: GradeCutEntry[];
  try {
    normalized = normalizeCuts(cuts);
  } catch {
    throw new GradeCutValidationError(
      "malformed",
      "등급컷 형식이 올바르지 않습니다 (등급 중복·순서·범위).",
    );
  }
  const max = maxRawScore(subject);
  const over = normalized.find(
    (cut) => (cut.rawScoreMax ?? cut.rawScore) !== null && (cut.rawScoreMax ?? cut.rawScore)! > max,
  );
  if (over) {
    const score = over.rawScoreMax ?? over.rawScore;
    throw new GradeCutValidationError(
      "over_max",
      `${over.grade}등급 원점수 ${score}점이 만점(${max}점)을 넘습니다.`,
    );
  }
  const top = normalized.find((cut) => cut.grade === 1);
  const topMinimum = top?.rawScoreMin ?? top?.rawScore;
  if (top && topMinimum === 0)
    throw new GradeCutValidationError("zero_top_grade", "1등급 컷이 0점일 수 없습니다.");
  return normalized;
}

/** 관측 시각: 유효한 날짜, 시험 종료 이후, 현재보다 미래가 아님 (시계 오차 10분 허용) */
export function checkObservedAt(exam: WatchExam, observedAt: Date, now: Date): void {
  const t = observedAt.getTime();
  if (!Number.isFinite(t))
    throw new GradeCutValidationError("bad_observed_at", "관측 시각이 올바르지 않습니다.");
  if (t < examEndAt(exam).getTime())
    throw new GradeCutValidationError("bad_observed_at", "시험 종료 전에 관측된 등급컷입니다.");
  if (t > now.getTime() + 10 * 60_000)
    throw new GradeCutValidationError("bad_observed_at", "관측 시각이 미래입니다.");
}

export interface ValidCut {
  cuts: GradeCutEntry[];
  sourceUrl: string;
}

export function validateGradeCut(input: {
  exam: WatchExam;
  subject: Subject;
  source: GradeCutSource;
  sourceUrl: string;
  cuts: GradeCutEntry[];
  observedAt: Date;
  now: Date;
}): ValidCut {
  const url = checkSourceUrl(input.source, input.sourceUrl, { strictHost: true });
  const cuts = checkCuts(input.subject, input.cuts);
  checkObservedAt(input.exam, input.observedAt, input.now);
  return { cuts, sourceUrl: url.toString() };
}

/**
 * 한 번의 수집에서 같은 슬롯이 여러 번 나오면: 값이 모두 같으면 하나만, 다르면 모두 버린다 (모호함).
 * 반환: 남길 값, 모순으로 버린 슬롯 key.
 */
export function dedupeCollected<T extends { cuts: GradeCutEntry[] }>(
  values: readonly T[],
  keyOf: (value: T) => string,
): { kept: T[]; conflicting: string[] } {
  const groups = new Map<string, T[]>();
  for (const v of values) {
    const k = keyOf(v);
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  const kept: T[] = [];
  const conflicting: string[] = [];
  for (const [k, group] of groups) {
    const prints = new Set(
      group.map((v) => {
        try {
          return cutsFingerprint(v.cuts);
        } catch {
          return `invalid:${Math.random()}`;
        }
      }),
    );
    if (prints.size === 1) kept.push(group[0]!);
    else conflicting.push(k);
  }
  return { kept, conflicting };
}
