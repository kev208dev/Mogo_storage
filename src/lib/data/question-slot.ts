/**
 * 세부과목 페이지의 문항 = 그 과목 문항 + 번호가 겹치지 않는 공통 문항.
 * 예) 국어 화법과 작문: 공통 1~34 (course 없음) + 선택 35~45 → 1~45 로 채점.
 * 세부과목 문항이 하나도 없으면 공통만 보여주지 않는다 (만점이 달라져 채점이 틀려진다).
 * 탐구처럼 과목 문항이 1번부터 전부 있으면 공통 문항은 붙지 않는다.
 */
export function questionsForSlot<T extends { courseId: string | null; questionNumber: number }>(
  rows: readonly T[],
  courseId: string | null,
): T[] {
  if (!courseId) return rows.filter((r) => r.courseId === null);
  const own = rows.filter((r) => r.courseId === courseId);
  if (!own.length) return [];
  const taken = new Set(own.map((r) => r.questionNumber));
  return [...own, ...rows.filter((r) => r.courseId === null && !taken.has(r.questionNumber))].sort(
    (a, b) => a.questionNumber - b.questionNumber,
  );
}
