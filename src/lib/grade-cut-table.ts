import type { GradeCutSource } from "./constants";
import type { GradeCut, GradeCutEntry } from "./data/types";

type RangeEntry = GradeCutEntry;

const DEFAULT_COLUMNS: GradeCutSource[] = ["official", "megastudy"];

export function gradeCutTableColumns(gradeCuts: GradeCut[]): GradeCutSource[] {
  const present = gradeCuts.map((cut) => cut.source);
  return [...new Set([...DEFAULT_COLUMNS, ...present])];
}

export function gradeCutTableGrades(): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9];
}

export function gradeCutValue(
  gradeCuts: GradeCut[],
  source: GradeCutSource,
  grade: number,
): number | null {
  const entry = gradeCuts
    .find((cut) => cut.source === source)
    ?.cuts.find((cut) => cut.grade === grade) as RangeEntry | undefined;
  return typeof entry?.rawScore === "number" ? entry.rawScore : null;
}

export function gradeCutValueLabel(
  gradeCuts: GradeCut[],
  source: GradeCutSource,
  grade: number,
): string {
  const entry = gradeCuts
    .find((cut) => cut.source === source)
    ?.cuts.find((cut) => cut.grade === grade) as RangeEntry | undefined;
  if (!entry) return "-";
  const raw =
    Number.isFinite(entry.rawScoreMin) && Number.isFinite(entry.rawScoreMax)
      ? `${entry.rawScoreMin}~${entry.rawScoreMax}`
      : typeof entry.rawScore === "number"
        ? String(entry.rawScore)
        : entry.rawScoreText ?? null;
  const details = [
    raw === null
      ? null
      : entry.standardScore != null || entry.percentile != null
        ? `원점수 ${raw}`
        : raw,
    entry.standardScore == null ? null : `표준점수 ${entry.standardScore}`,
    entry.percentile == null ? null : `백분위 ${entry.percentile}`,
  ].filter((value): value is string => value !== null);
  return details.length > 0 ? details.join(" · ") : "-";
}

export function hasOnlySingleValueCuts(cut: GradeCut): boolean {
  return cut.cuts.every((entry) => {
    const candidate = entry as RangeEntry;
    return (
      typeof candidate.rawScore === "number" &&
      candidate.rawScoreMin === undefined &&
      candidate.rawScoreMax === undefined
    );
  });
}

export function isOfficialGradeCutColumn(source: GradeCutSource): boolean {
  return source === "official";
}
