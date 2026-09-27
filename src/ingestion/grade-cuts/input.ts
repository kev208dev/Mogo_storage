import type { GradeCutEntry } from "../../lib/data/types";
import {
  GRADE_CUT_SOURCES,
  SUBJECTS,
  type GradeCutSource,
  type Subject,
} from "../../lib/constants";
import { parseCsv } from "../manual-import/csv";
import { checkCuts, checkSourceUrl, GradeCutInputError } from "./validate";

export { GradeCutInputError } from "./validate";

/**
 * 관리자 입력용 등급컷 parser.
 * 한 줄에 "1: 88", "1,88", "1 88" 형식을 받는다.
 * 일부 등급만 입력할 수 있지만, 입력된 컷은 등급이 내려갈수록 같거나 낮아야 한다.
 */
export function parseGradeCutEntries(input: string): GradeCutEntry[] {
  const rows = input
    .split(/\r?\n|;/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length === 0) throw new GradeCutInputError("등급컷을 한 줄 이상 입력하세요.");

  const seen = new Set<number>();
  const cuts: GradeCutEntry[] = [];
  for (const row of rows) {
    const cleaned = row.replace(/등급/g, "").replace(/점/g, "").trim();
    const match = /^([1-9])\s*[:,=\t ]+\s*(\d{1,3})(?:\s*[~～-]\s*(\d{1,3}))?$/.exec(cleaned);
    if (!match) {
      throw new GradeCutInputError(`등급컷 형식이 올바르지 않습니다: "${row}" (예: 1: 88)`);
    }
    const grade = Number(match[1]);
    const rawScoreMin = Number(match[2]);
    const rawScoreMax = match[3] ? Number(match[3]) : rawScoreMin;
    if (rawScoreMin < 0 || rawScoreMax > 100 || rawScoreMin > rawScoreMax) {
      throw new GradeCutInputError(`${grade}등급 원점수 범위가 올바르지 않습니다.`);
    }
    if (seen.has(grade)) throw new GradeCutInputError(`${grade}등급이 중복되었습니다.`);
    seen.add(grade);
    cuts.push(
      rawScoreMin === rawScoreMax
        ? { grade, rawScore: rawScoreMin }
        : { grade, rawScore: null, rawScoreMin, rawScoreMax },
    );
  }

  cuts.sort((a, b) => a.grade - b.grade);
  for (let i = 1; i < cuts.length; i += 1) {
    const previous = cuts[i - 1]!;
    const current = cuts[i]!;
    const currentHigh = current.rawScore === null ? current.rawScoreMax : current.rawScore;
    const previousLow = previous.rawScore === null ? previous.rawScoreMin : previous.rawScore;
    if (currentHigh > previousLow) {
      throw new GradeCutInputError(
        `${current.grade}등급 컷은 ${previous.grade}등급 컷보다 높을 수 없습니다.`,
      );
    }
  }
  return cuts;
}

/** 출처 링크는 관리자 브라우저용이며 서버에서 fetch 하지 않는다. HTTPS 링크만 저장한다. */
export function parseGradeCutSourceUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new GradeCutInputError("출처 URL을 입력하세요.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GradeCutInputError("출처 URL 형식이 올바르지 않습니다.");
  }
  if (url.protocol !== "https:")
    throw new GradeCutInputError("출처 URL은 HTTPS 주소만 사용할 수 있습니다.");
  if (url.username || url.password)
    throw new GradeCutInputError("인증정보가 포함된 출처 URL은 사용할 수 없습니다.");
  return url.toString();
}

export const GRADE_CUT_CSV_HEADER = "year,grade,month,subject,course_code,source,source_url,cuts";

export interface ParsedGradeCutCsvRow {
  line: number;
  year: number;
  grade: 1 | 2 | 3;
  month: number;
  subject: Subject;
  courseCode: string | null;
  source: GradeCutSource;
  sourceUrl: string;
  cuts: GradeCutEntry[];
}

export interface InvalidGradeCutCsvRow {
  line: number;
  error: string;
}

/**
 * 대량 등급컷 CSV parser.
 * cuts 필드는 RFC 4180 따옴표로 감싸 "1:88;2:80;3:72"처럼 넣는다.
 * DB 조회가 필요한 시험/세부과목 존재 여부는 server action에서 검증한다.
 */
export function parseGradeCutCsv(text: string): {
  rows: ParsedGradeCutCsvRow[];
  invalid: InvalidGradeCutCsvRow[];
} {
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    throw new GradeCutInputError(
      error instanceof Error ? error.message : "CSV를 읽을 수 없습니다.",
    );
  }
  if (parsed.length === 0) throw new GradeCutInputError("CSV가 비어 있습니다.");

  const expected = GRADE_CUT_CSV_HEADER.split(",");
  const actual = parsed[0]!.cells.map((cell) => cell.trim());
  if (actual.length !== expected.length || actual.some((cell, index) => cell !== expected[index])) {
    throw new GradeCutInputError(
      `CSV 헤더가 올바르지 않습니다. 필요한 헤더: ${GRADE_CUT_CSV_HEADER}`,
    );
  }

  const rows: ParsedGradeCutCsvRow[] = [];
  const invalid: InvalidGradeCutCsvRow[] = [];
  for (const row of parsed.slice(1)) {
    try {
      if (row.cells.length !== expected.length) {
        throw new GradeCutInputError(`열 개수가 ${expected.length}개여야 합니다.`);
      }
      const [yearRaw, gradeRaw, monthRaw, subjectRaw, courseRaw, sourceRaw, urlRaw, cutsRaw] =
        row.cells.map((cell) => cell.trim());

      const year = Number(yearRaw);
      const grade = Number(gradeRaw);
      const month = Number(monthRaw);
      if (!Number.isInteger(year) || year < 2006 || year > 2099)
        throw new GradeCutInputError("year가 올바르지 않습니다.");
      if (![1, 2, 3].includes(grade))
        throw new GradeCutInputError("grade는 1, 2, 3 중 하나여야 합니다.");
      if (!Number.isInteger(month) || month < 1 || month > 12)
        throw new GradeCutInputError("month가 올바르지 않습니다.");
      if (!(SUBJECTS as readonly string[]).includes(subjectRaw))
        throw new GradeCutInputError("subject가 올바르지 않습니다.");
      if (!(GRADE_CUT_SOURCES as readonly string[]).includes(sourceRaw))
        throw new GradeCutInputError("source가 올바르지 않습니다.");
      if (courseRaw && !/^[a-z0-9-]{1,60}$/.test(courseRaw))
        throw new GradeCutInputError("course_code가 올바르지 않습니다.");

      rows.push({
        line: row.line,
        year,
        grade: grade as 1 | 2 | 3,
        month,
        subject: subjectRaw as Subject,
        courseCode: courseRaw || null,
        source: sourceRaw as GradeCutSource,
        sourceUrl: checkSourceUrl(
          sourceRaw as GradeCutSource,
          parseGradeCutSourceUrl(urlRaw ?? ""),
        ).toString(),
        cuts: checkCuts(subjectRaw as Subject, parseGradeCutEntries(cutsRaw ?? "")),
      });
    } catch (error) {
      invalid.push({
        line: row.line,
        error: error instanceof Error ? error.message : "잘못된 행입니다.",
      });
    }
  }
  return { rows, invalid };
}
