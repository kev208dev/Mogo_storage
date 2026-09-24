import { resolveCourse } from "../ingestion/canonical/course";
import { normalizeSubject } from "../ingestion/canonical/subject";
import type { Grade, Subject } from "./constants";
import { courseByCode } from "./courses";
import { MAX_YEAR, MIN_YEAR } from "./exam-path";

export interface ParsedExamQuery {
  year: number | null;
  grade: Grade | null;
  month: number | null;
}

/** 검색어에 과목/세부과목이 있으면 (예: "사회문화", "영어") 해당 페이지로 보낸다 */
export interface QueryTarget {
  subject: Subject | null;
  courseCode: string | null;
}

export type ExamQueryParseResult =
  | ({ ok: true; year: number; grade: Grade; month: number } & QueryTarget)
  | ({ ok: false; partial: ParsedExamQuery; missing: Array<keyof ParsedExamQuery> } & QueryTarget);

/**
 * 시험 표기를 뺀 나머지 글자에서 과목/세부과목. 확실한 경우만 (모호하면 null → 시험 페이지로).
 */
export function detectTarget(rest: string): QueryTarget {
  // 검색어는 소문자로 정규화돼 있다: "일본어ⅰ"/"물리학 ii" 같은 로마 숫자를 되돌리고, 과목명에 붙지 않은 숫자만 지운다
  const text = rest
    .replace(/(?<=[가-힣])\s*ii(?![a-z])/g, "2")
    .replace(/(?<=[가-힣])\s*i(?![a-z])/g, "1")
    .replace(/(?<![가-힣])\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { subject: null, courseCode: null };
  const course = resolveCourse(text);
  if (course.status === "resolved" && course.confidence >= 0.9) {
    const def = courseByCode(course.code);
    if (def) return { subject: def.subject, courseCode: def.code };
  }
  return { subject: normalizeSubject(text), courseCode: null };
}

/**
 * 자유 입력 검색어를 year / grade / month 로 해석한다.
 *
 * 지원 예:
 *  - "2025 고2 9월", "2025년 고2 9월 모의고사"
 *  - "25 고2 9모", "24년 고3 6모"
 *  - "2023 고1 3월", "2학년 2024 11월", "고3 2025 9평"
 *  - "2025-high2-09", "2025/2/9" 같은 기계적 입력은 grade 표기가 있을 때만 해석한다.
 *
 * `6평`, `9평`(평가원 모의평가)은 학년이 없으면 고3으로 간주한다.
 */
export function parseExamQuery(input: string, now: Date = new Date()): ExamQueryParseResult {
  let text = normalize(input);

  let grade: Grade | null = null;
  let month: number | null = null;
  let year: number | null = null;
  let isKicePattern = false;

  // 1) 학년: "고2", "고 2", "2학년", "high2"
  const gradeMatch =
    /고\s*([1-3])(?!\d)/.exec(text) ??
    /(?<!\d)([1-3])\s*학년/.exec(text) ??
    /high\s*([1-3])(?!\d)/.exec(text);
  if (gradeMatch) {
    grade = Number(gradeMatch[1]) as Grade;
    text = cut(text, gradeMatch);
  }

  // 2) 월: "9월", "9모", "09월", "6평"
  const monthMatch = /(?<!\d)(0?[1-9]|1[0-2])\s*(월|모|평)/.exec(text);
  if (monthMatch) {
    month = Number(monthMatch[1]);
    isKicePattern = monthMatch[2] === "평";
    text = cut(text, monthMatch);
  }

  // 3) 년도: "2025", "2025년", "25년", "25"
  const fullYear = /(?<!\d)(\d{4})\s*(?:년|학년도)?/.exec(text);
  if (fullYear) {
    year = Number(fullYear[1]);
    text = cut(text, fullYear);
  } else {
    const shortYear = /(?<!\d)(\d{2})\s*(?:년|학년도)?(?!\d)/.exec(text);
    if (shortYear) {
      year = 2000 + Number(shortYear[1]);
      text = cut(text, shortYear);
    }
  }

  // 4) 월 표기가 없고 숫자만 남았다면 월로 본다. ("2025 고2 9")
  if (month === null) {
    const bareMonth = /(?<!\d)(0?[1-9]|1[0-2])(?!\d)/.exec(text);
    if (bareMonth) month = Number(bareMonth[1]);
  }

  if (grade === null && isKicePattern) grade = 3;

  if (year !== null && (year < MIN_YEAR || year > Math.min(MAX_YEAR, now.getFullYear() + 1))) {
    year = null;
  }

  const target = detectTarget(text);
  const partial: ParsedExamQuery = { year, grade, month };
  if (year !== null && grade !== null && month !== null) {
    return { ok: true, year, grade, month, ...target };
  }
  const missing = (Object.keys(partial) as Array<keyof ParsedExamQuery>).filter(
    (key) => partial[key] === null,
  );
  return { ok: false, partial, missing, ...target };
}

function normalize(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/모의고사|모의평가|학력평가|학평|전국연합|기출|시험지|해설|다운로드|pdf/g, " ")
    .replace(/[.,/\\_\-~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cut(text: string, match: RegExpExecArray): string {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
}
