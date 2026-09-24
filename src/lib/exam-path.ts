import {
  GRADES,
  SUBJECTS,
  SUBJECT_SEGMENTS,
  type Grade,
  type Subject,
  DEFAULT_SUBJECT,
} from "./constants";

export interface ExamKey {
  year: number;
  grade: Grade;
  month: number;
}

export const MIN_YEAR = 2006;
export const MAX_YEAR = 2099;

export function gradeSegment(grade: Grade): string {
  return `high${grade}`;
}

export function monthSegment(month: number): string {
  return String(month).padStart(2, "0");
}

/** /exam/2025/high2/09 */
export function examPath(key: ExamKey, subject?: Subject): string {
  const base = `/exam/${key.year}/${gradeSegment(key.grade)}/${monthSegment(key.month)}`;
  return subject && subject !== DEFAULT_SUBJECT ? `${base}/${subjectSegment(subject)}` : base;
}

export function examSlug(key: ExamKey): string {
  return `${key.year}-high${key.grade}-${monthSegment(key.month)}`;
}

export function examTitle(key: Pick<ExamKey, "year" | "grade" | "month">): string {
  return `${key.year}년 고${key.grade} ${key.month}월 모의고사`;
}

export function examShortTitle(key: ExamKey): string {
  return `${key.year} 고${key.grade} ${key.month}월`;
}

export function parseGradeSegment(segment: string): Grade | null {
  const match = /^high([1-3])$/.exec(segment);
  if (!match) return null;
  const grade = Number(match[1]);
  return (GRADES as readonly number[]).includes(grade) ? (grade as Grade) : null;
}

export function parseYearSegment(segment: string): number | null {
  if (!/^\d{4}$/.test(segment)) return null;
  const year = Number(segment);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

/** "09"만 허용한다. ("9"는 canonical이 아니므로 route에서 redirect 처리) */
export function parseMonthSegment(segment: string): number | null {
  if (!/^\d{1,2}$/.test(segment)) return null;
  const month = Number(segment);
  return month >= 1 && month <= 12 ? month : null;
}

export function parseExamParams(params: {
  year: string;
  grade: string;
  month: string;
}): ExamKey | null {
  const year = parseYearSegment(params.year);
  const grade = parseGradeSegment(params.grade);
  const month = parseMonthSegment(params.month);
  if (year === null || grade === null || month === null) return null;
  return { year, grade, month };
}

export function isSubject(value: string): value is Subject {
  return (SUBJECTS as readonly string[]).includes(value);
}

export function subjectSegment(subject: Subject): string {
  return SUBJECT_SEGMENTS[subject];
}

/** URL segment → 영역 ("second-language" → second_language). enum 표기("second_language")는 받지 않는다 */
export function parseSubjectSegment(segment: string): Subject | null {
  return SUBJECTS.find((s) => SUBJECT_SEGMENTS[s] === segment) ?? null;
}

/** 세부과목 페이지: /exam/2026/high3/09/social/social-culture (국어 선택과목도 영역 segment 를 항상 포함) */
export function examCoursePath(key: ExamKey, subject: Subject, courseCode: string): string {
  const base = `/exam/${key.year}/${gradeSegment(key.grade)}/${monthSegment(key.month)}`;
  return `${base}/${subjectSegment(subject)}/${courseCode}`;
}
