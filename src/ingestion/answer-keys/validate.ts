import type { Subject } from "../../lib/constants";
import { resolveCourse } from "../canonical/course";
import type { AnswerEntry, ParsedAnswerKey } from "./parse";

/**
 * 정답표 · 배점 검증. 통과하지 못하면 게시하지 않고 manual_review 로 남긴다.
 *  - 문항 수: 영역별 총 문항 수와 일치 (공통 + 각 선택 = 총 문항)
 *  - 연속성: 1번(선택은 공통 다음 번호)부터 빠짐없이
 *  - 값 범위: 선택형 1~5, 단답형은 수학만 0~999 정수
 *  - 본문 "정답 ④" 표기가 있으면 빠른 정답표와 모두 일치
 *  - 배점: 2~4점, 합계가 영역 만점, 문항 수 일치
 */

export const QUESTION_COUNT: Record<Subject, number> = {
  korean: 45,
  math: 30,
  english: 45,
  history: 20,
  social: 20,
  science: 20,
  vocational: 20,
  second_language: 30,
};

/** 배점 표기가 없는 문항의 배점, 허용 범위 */
export function pointsRule(subject: Subject): { base: number; min: number; max: number } {
  if (subject === "second_language") return { base: 1, min: 1, max: 2 };
  if (subject === "math") return { base: 2, min: 2, max: 4 };
  return { base: 2, min: 2, max: 3 };
}

export function totalPoints(subject: Subject): number {
  return subject === "korean" || subject === "math" || subject === "english" ? 100 : 50;
}

export type AnswerKeyReason =
  | "no_table"
  | "parse_problem"
  | "count_mismatch"
  | "not_continuous"
  | "bad_domain"
  | "marker_mismatch"
  | "unknown_elective"
  | "elective_range_mismatch"
  | "solution_identity"
  | "reordered_unverified";

export interface VerifiedSection {
  /** null = 공통(또는 영역 전체), 그 외 선택 과목 course code */
  courseCode: string | null;
  label: string | null;
  entries: AnswerEntry[];
}

export interface AnswerKeyCheck {
  ok: boolean;
  reasons: Array<{ code: AnswerKeyReason; detail: string }>;
  sections: VerifiedSection[];
  /** 본문 "정답" 표기로 교차 확인된 문항 수 */
  crossChecked: number;
}

function continuous(entries: AnswerEntry[], from: number, to: number): boolean {
  const nums = entries.map((e) => e.number).sort((a, b) => a - b);
  return nums.length === to - from + 1 && nums.every((n, i) => n === from + i);
}

export function checkAnswerKey(parsed: ParsedAnswerKey, subject: Subject): AnswerKeyCheck {
  const reasons: AnswerKeyCheck["reasons"] = [];
  const total = QUESTION_COUNT[subject];
  const sections: VerifiedSection[] = [];
  let crossChecked = 0;

  if (!parsed.sections.length) reasons.push({ code: "no_table", detail: "빠른 정답표 없음" });
  for (const p of parsed.problems) reasons.push({ code: "parse_problem", detail: p });

  const common = parsed.sections.filter((s) => s.kind !== "elective");
  const electives = parsed.sections.filter((s) => s.kind === "elective");
  if (common.length > 1)
    reasons.push({ code: "parse_problem", detail: `공통/단일 정답표가 ${common.length}개` });

  const base = common[0];
  const commonEnd = electives.length ? (base?.entries.length ?? 0) : total;
  if (base) {
    if (base.entries.length !== commonEnd || (!electives.length && base.entries.length !== total))
      reasons.push({
        code: "count_mismatch",
        detail: `${base.label ?? "정답표"} ${base.entries.length}문항 (예상 ${electives.length ? "공통" : total})`,
      });
    if (!continuous(base.entries, 1, base.entries.length))
      reasons.push({
        code: "not_continuous",
        detail: `${base.label ?? "정답표"} 번호가 1번부터 연속되지 않음`,
      });
    sections.push({ courseCode: null, label: base.label, entries: base.entries });
  }
  for (const e of electives) {
    const code = resolveCourse(e.courseLabel ?? "", { subject });
    if (code.status !== "resolved") {
      reasons.push({
        code: "unknown_elective",
        detail: `선택 과목 "${e.courseLabel}"을 확정할 수 없음`,
      });
      continue;
    }
    if (commonEnd + e.entries.length !== total || !continuous(e.entries, commonEnd + 1, total))
      reasons.push({
        code: "elective_range_mismatch",
        detail: `${e.label}: ${commonEnd + 1}~${total}번이어야 함`,
      });
    if (sections.some((s) => s.courseCode === code.code))
      reasons.push({
        code: "parse_problem",
        detail: `선택 과목 "${e.courseLabel}" 정답표가 두 번`,
      });
    sections.push({ courseCode: code.code, label: e.label, entries: e.entries });
  }

  for (const s of sections)
    for (const entry of s.entries) {
      const n = Number(entry.answer);
      const okDomain = entry.choice
        ? n >= 1 && n <= 5
        : subject === "math" && Number.isInteger(n) && n >= 0 && n <= 999;
      if (!okDomain)
        reasons.push({
          code: "bad_domain",
          detail: `${s.label ?? ""} ${entry.number}번 정답 "${entry.answer}"`.trim(),
        });
      if (entry.reordered && entry.marker === null)
        reasons.push({
          code: "reordered_unverified",
          detail:
            `${s.label ?? ""} ${entry.number}번: 텍스트 순서가 흩어진 정답표인데 본문 정답 표기가 없음`.trim(),
        });
      if (entry.marker !== null) {
        if (!entry.choice || entry.marker !== entry.answer)
          reasons.push({
            code: "marker_mismatch",
            detail:
              `${s.label ?? ""} ${entry.number}번: 정답표 ${entry.answer} · 본문 ${entry.marker}`.trim(),
          });
        else crossChecked++;
      }
    }

  return { ok: reasons.length === 0, reasons, sections, crossChecked };
}

export type PointsReason = "count_mismatch" | "sum_mismatch" | "bad_points" | "identity";

/** 문제지 한 부(공통 + 선택 하나, 또는 영역 전체)의 배점 검증 */
export function checkPoints(
  points: Map<number, number>,
  found: number,
  subject: Subject,
): { ok: boolean; reasons: Array<{ code: PointsReason; detail: string }> } {
  const reasons: Array<{ code: PointsReason; detail: string }> = [];
  const total = QUESTION_COUNT[subject];
  if (found !== total || points.size !== total)
    reasons.push({ code: "count_mismatch", detail: `문항 ${found}개 (예상 ${total})` });
  const { min, max } = pointsRule(subject);
  for (const [n, p] of points)
    if (!Number.isInteger(p) || p < min || p > max)
      reasons.push({ code: "bad_points", detail: `${n}번 ${p}점` });
  const sum = [...points.values()].reduce((a, b) => a + b, 0);
  if (sum !== totalPoints(subject))
    reasons.push({ code: "sum_mismatch", detail: `합계 ${sum}점 (예상 ${totalPoints(subject)})` });
  return { ok: reasons.length === 0, reasons };
}
