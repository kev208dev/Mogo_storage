import { GRADE_CUT_SOURCE_LABELS, GRADE_CUT_SOURCES, type GradeCutSource } from "./constants";
import type { GradeCut, GradeCutEntry } from "./data/types";

type RangeEntry = GradeCutEntry;

/**
 * 표에 실제로 값이 있는 출처만 보여준다 (빈 "공식" 열을 만들어 공식 값이 있는 것처럼 보이지 않게).
 * 순서: 공식(is_official) → 상수에 정의된 출처 순서.
 */
export function gradeCutTableColumns(gradeCuts: GradeCut[]): GradeCutSource[] {
  const present = new Set(gradeCuts.map((cut) => cut.source));
  return GRADE_CUT_SOURCES.filter((source) => present.has(source)).sort(
    (a, b) =>
      Number(gradeCuts.some((c) => c.source === b && c.isOfficial)) -
      Number(gradeCuts.some((c) => c.source === a && c.isOfficial)),
  );
}

export type GradeCutStatusKind = "official" | "provider_final" | "estimate";

/**
 * 공식 여부는 is_official(공식 출처 도메인으로 검증된 행)로만 정한다.
 * 업체가 "최종/확정"이라고 표기한 값(provider_final)도 공식이 아니다.
 */
export function gradeCutStatusKind(cut: Pick<GradeCut, "isOfficial" | "providerStatus">) {
  if (cut.isOfficial) return "official" as const;
  if (cut.providerStatus === "provider_final") return "provider_final" as const;
  return "estimate" as const;
}

export const GRADE_CUT_STATUS_LABELS: Record<GradeCutStatusKind, string> = {
  official: "공식",
  provider_final: "업체 최종 · 비공식",
  estimate: "예상 · 비공식",
};

/** 열 제목: 출처가 붙인 표기(providerLabel)를 우선하고, 없으면 출처명 */
export function gradeCutColumnTitle(cut: GradeCut | undefined, source: GradeCutSource): string {
  if (cut?.isOfficial) return "공식 확정";
  return cut?.providerLabel ?? GRADE_CUT_SOURCE_LABELS[source];
}

/**
 * 같은 등급에서 출처별 값이 서로 다른지. 값을 평균내거나 고르지 않고, 다르다는 사실만 표시한다.
 * 비교는 화면에 보이는 원문 표기(범위·소수점 포함) 그대로 한다.
 */
export function gradeCutValuesDiffer(gradeCuts: GradeCut[], grade: number): boolean {
  const labels = new Set(
    gradeCuts
      .map((cut) => rawLabel(cut.cuts.find((entry) => entry.grade === grade)))
      .filter((label): label is string => label !== null),
  );
  return labels.size > 1;
}

/** 원점수 표기만 (표준점수·백분위 유무는 "값 차이"로 보지 않는다) */
function rawLabel(entry: RangeEntry | undefined): string | null {
  if (!entry) return null;
  if (Number.isFinite(entry.rawScoreMin) && Number.isFinite(entry.rawScoreMax))
    return `${entry.rawScoreMin}~${entry.rawScoreMax}`;
  if (typeof entry.rawScore === "number") return String(entry.rawScore);
  return entry.rawScoreText ?? null;
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
        : (entry.rawScoreText ?? null);
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
