import type { GradeCutSource } from "./constants";
import type { GradeCut } from "./data/types";

/**
 * Relative-grading columns: official and the only currently enabled automated
 * estimate source. Policy-disabled EBS/Daesung sources are omitted when empty.
 */
export function gradeCutTableColumns(_gradeCuts: GradeCut[]): GradeCutSource[] {
  return ["official", "megastudy"];
}

export function gradeCutTableGrades(): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9];
}

export function gradeCutValue(
  gradeCuts: GradeCut[],
  source: GradeCutSource,
  grade: number,
): number | null {
  const row = gradeCuts.find((cut) => cut.source === source);
  return row?.cuts.find((cut) => cut.grade === grade)?.rawScore ?? null;
}
