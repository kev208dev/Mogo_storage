import type { GradeCutEntry } from "./data/types";

export interface GradeEstimate {
  /** 정확한 등급을 판정할 수 있으면 grade, 입력된 최저 컷 아래면 null */
  grade: number | null;
  label: string;
}

/**
 * 저장된 원점수 컷만 사용해 등급을 계산한다.
 * 일부 등급만 등록된 경우 최저 컷보다 낮은 점수는 추측하지 않는다.
 */
export function estimateGrade(cuts: GradeCutEntry[], rawScore: number): GradeEstimate | null {
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 100 || cuts.length === 0)
    return null;

  const sorted = [...cuts].sort((a, b) => a.grade - b.grade);
  for (const cut of sorted) {
    if (rawScore >= cut.rawScore) return { grade: cut.grade, label: `${cut.grade}등급` };
  }
  const last = sorted.at(-1);
  return last ? { grade: null, label: `${last.grade}등급 컷 미만` } : null;
}
