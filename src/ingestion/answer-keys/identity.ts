import type { ExamType, Subject } from "../../lib/constants";
import { COURSE_CATALOG } from "../../lib/courses";
import { normalizeCourseLabel } from "../canonical/course";

/**
 * PDF 머리말이 기대한 시험·영역·과목과 **모순되는지** 확인한다.
 * 문제지 머리말은 이미지인 경우가 많아 "언급이 없음"은 허용하고(파일 슬롯은 운영자가 브라우저로 확인한 값),
 * 다른 영역·과목·학년도·월이 적혀 있을 때만 거부한다.
 */

const AREA_LABELS: Array<{ subject: Subject; pattern: RegExp }> = [
  { subject: "korean", pattern: /국어영역/ },
  { subject: "math", pattern: /수학영역/ },
  { subject: "english", pattern: /영어영역/ },
  { subject: "history", pattern: /한국사영역/ },
  { subject: "social", pattern: /사회탐구/ },
  { subject: "science", pattern: /과학탐구/ },
  { subject: "vocational", pattern: /직업탐구/ },
  { subject: "second_language", pattern: /제2외국어/ },
];

export interface ExamIdentity {
  year: number;
  month: number;
  examType: ExamType;
}

export function headerConflicts(
  pages: readonly string[],
  expected: { exam: ExamIdentity; subject: Subject; courseCode: string | null },
): string[] {
  const head = (pages[0] ?? "").slice(0, 400);
  // 반복 인쇄된 머리말("과학탐구과학탐구과학탐구영역…")도 그대로 포함 검사된다
  const flat = head.replace(/\s+/g, "");
  const conflicts: string[] = [];

  const areas = AREA_LABELS.filter((a) => a.pattern.test(flat)).map((a) => a.subject);
  if (areas.length && !areas.includes(expected.subject))
    conflicts.push(`머리말 영역(${areas.join(",")})이 ${expected.subject} 과 다름`);

  if (expected.courseCode) {
    const norm = normalizeCourseLabel(head);
    const named = COURSE_CATALOG.filter(
      (c) =>
        c.subject === expected.subject &&
        [c.name, ...c.aliases].some((n) => {
          const k = normalizeCourseLabel(n);
          return k.length >= 2 && norm.includes(k);
        }),
    ).map((c) => c.code);
    // "화학1" 머리말에 "화학2" 가 부분 일치로 잡히지 않도록, 기대 과목이 있으면 통과
    if (named.length && !named.includes(expected.courseCode))
      conflicts.push(`머리말 과목(${named.join(",")})이 ${expected.courseCode} 와 다름`);
  }

  const line = /(\d{4})학년도\s*(대학수학능력시험)?\s*(?:(\d{1,2})월)?/.exec(head);
  if (line) {
    const schoolYear = Number(line[1]);
    const wanted =
      expected.exam.examType === "school_mock" ? expected.exam.year : expected.exam.year + 1;
    if (schoolYear !== wanted) conflicts.push(`머리말 ${schoolYear}학년도 ≠ 기대 ${wanted}학년도`);
    const month = line[3]
      ? Number(line[3])
      : line[2] && expected.exam.examType === "csat"
        ? 11
        : null;
    if (month !== null && month !== expected.exam.month)
      conflicts.push(`머리말 ${month}월 ≠ 기대 ${expected.exam.month}월`);
  }
  return conflicts;
}
