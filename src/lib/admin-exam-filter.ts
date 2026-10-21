import { GRADES } from "./constants";

export interface AdminExamFilter {
  year?: number;
  month?: number;
  grade?: number;
}
export function adminExamFilter(
  params: Record<string, string | string[] | undefined>,
): AdminExamFilter {
  const number = (key: string, min: number, max: number) => {
    const raw = params[key];
    const n = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const grade = number("grade", 1, Math.max(...GRADES));
  return { year: number("year", 2000, 2100), month: number("month", 1, 12), grade };
}
export function matchesExam(
  exam: { year: number; month: number; grade: number },
  filter: AdminExamFilter,
) {
  return (
    (!filter.year || exam.year === filter.year) &&
    (!filter.month || exam.month === filter.month) &&
    (!filter.grade || exam.grade === filter.grade)
  );
}
