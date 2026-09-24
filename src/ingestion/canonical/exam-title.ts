import type { ExamType, Grade } from "../../lib/constants";
import type { CanonicalExam } from "../types";

export interface TitleHints {
  /** 목록 페이지 등에서 알 수 있는 시행 연도 (제목에 연도가 없을 때) */
  year?: number;
  grade?: Grade;
  month?: number;
  examType?: ExamType;
}

export type CanonicalizeResult = { ok: true; exam: CanonicalExam } | { ok: false; reason: string };

/**
 * source 마다 다른 시험명을 내부 identity 로 변환한다.
 *
 * 학년도 규칙 (중요):
 *  - "N학년도 대학수학능력시험" / "N학년도 6·9월 모의평가" 의 N 은 대입 학년도 → 시행 연도 = N - 1
 *  - "N학년도 ... 대비" 도 대입 학년도 표기로 본다
 *  - 전국연합학력평가의 "N학년도" 는 학교 학년도 = 시행 연도 N
 *  - "N년" 은 항상 시행 연도
 *  - 내부 year(URL, SEO 제목)는 언제나 시행 연도, academicYear 는 평가원 시험에만 저장
 */
export function canonicalizeExamTitle(
  rawTitle: string,
  hints: TitleHints = {},
): CanonicalizeResult {
  const title = rawTitle.normalize("NFKC").replace(/[·ㆍ]/g, " ").replace(/\s+/g, " ").trim();

  // ── 시험 종류 ──
  const isCsat = /(대학수학능력시험|수능)/.test(title) && !/(모의평가|모평|모의고사)/.test(title);
  const isKiceMock = /(모의평가|모평)/.test(title);
  const isSchoolMock = /(학력평가|학평|전국연합)/.test(title);

  // ── 연도 ──
  const academic = /(\d{4})\s*학년도/.exec(title);
  const calendar = /(\d{4})\s*년/.exec(title);
  const bareYear = /(?<!\d)(20\d{2})(?!\d)/.exec(title);
  const isEntranceStyle = isCsat || isKiceMock || /대비/.test(title);

  let year: number | null = null;
  if (calendar) year = Number(calendar[1]);
  else if (academic) year = Number(academic[1]) - (isEntranceStyle ? 1 : 0);
  else if (bareYear) year = Number(bareYear[1]);
  else if (hints.year) year = hints.year;
  if (!year || year < 2000 || year > 2100) return { ok: false, reason: "year not found" };

  // ── 월 ──
  let month: number | null = null;
  const monthMatch = /(?<!\d)(1[0-2]|0?[1-9])\s*월/.exec(title);
  if (monthMatch) month = Number(monthMatch[1]);
  else if (isCsat) month = 11;
  else if (/(?<!\d)([69])\s*(모|평)/.exec(title))
    month = Number(/(?<!\d)([69])\s*(모|평)/.exec(title)![1]);
  else if (hints.month) month = hints.month;
  if (!month) return { ok: false, reason: "month not found" };

  // ── 학년 ──
  let grade: Grade | null = null;
  const gradeMatch =
    /고\s*([1-3])(?!\d)/.exec(title) ?? /(?:고등학교\s*)?([1-3])\s*학년(?!도)/.exec(title);
  if (gradeMatch) grade = Number(gradeMatch[1]) as Grade;
  else if (isCsat || isKiceMock) grade = 3;
  else if (hints.grade) grade = hints.grade;
  if (!grade) return { ok: false, reason: "grade not found" };

  // ── 종류 확정 ──
  let examType: ExamType;
  if (isCsat) examType = "csat";
  else if (isKiceMock) examType = "kice_mock";
  else if (isSchoolMock) examType = "school_mock";
  else if (hints.examType) examType = hints.examType;
  else examType = grade === 3 && (month === 6 || month === 9) ? "kice_mock" : "school_mock";

  if ((examType === "kice_mock" || examType === "csat") && grade !== 3) {
    return { ok: false, reason: `grade ${grade} is not valid for ${examType}` };
  }
  if (examType === "csat" && month !== 11) {
    return { ok: false, reason: "csat must be in November" };
  }

  return {
    ok: true,
    exam: {
      year,
      grade,
      month,
      examType,
      academicYear: examType === "kice_mock" || examType === "csat" ? year + 1 : null,
    },
  };
}

/** 내부 identity key (DB unique: year + grade + month) */
export function canonicalKey(exam: Pick<CanonicalExam, "year" | "grade" | "month">): string {
  return `${exam.year}-${exam.grade}-${String(exam.month).padStart(2, "0")}`;
}

export function sameCanonicalExam(a: CanonicalExam, b: CanonicalExam): boolean {
  return canonicalKey(a) === canonicalKey(b) && a.examType === b.examType;
}
