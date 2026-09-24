import { EXAM_TYPES, FILE_TYPES, SUBJECTS, type ExamType, type Grade } from "../../lib/constants";
import { isCourseCode } from "../../lib/courses";
import { canonicalizeExamTitle, canonicalKey } from "../canonical/exam-title";
import { isHostAllowed } from "../net/url-policy";
import { parseBoardAttachments, parseBoardList } from "../sources/board/parser";
import { BUILTIN_SOURCES } from "../sources/config";
import { EDUCATION_OFFICE_DEFINITION } from "../sources/education-office/structure";
import { parseEbsiExamArtifacts, parseEbsiListing } from "../sources/ebsi/parser";
import { parseKiceExamIndex } from "../sources/kice/index-parser";
import { KICE_DEFINITION } from "../sources/kice/structure";
import { parseListeningArchive } from "../sources/listening-parser";
import type { CanonicalExam, DiscoveredArtifact, PageType } from "../types";

/** 예전 metadata 의 kind (호환용) */
export type LegacyFixtureKind = "listing" | "board-list" | "board-detail";

/** fixture 가 나타내는 시험 (목록 페이지면 null) */
export interface ExamIdentity {
  year: number;
  grade: Grade;
  month: number;
  examType: ExamType;
}

/**
 * fixture 마다 저장하는 기대 요약. 실제 페이지를 사람이 보고 확인한 값이어야 한다 (expectedReviewed).
 * parse 가 "성공"해도 요약이 달라지면 구조 변경 가능성으로 보고 실패시킨다.
 */
export interface FixtureExpectation {
  /** 비어 있는 목록 페이지 */
  empty?: boolean;
  examCount?: number;
  minimumExamCount?: number;
  /** 반드시 나와야 하는 영역 (예: ["korean","math","english","social"]) */
  containsSubjects?: string[];
  /** 반드시 나와야 하는 세부과목 code */
  containsCourses?: string[];
  minimumArtifactCount?: number;
  /** 공개 시각 표(exam_release_index)의 행 수 */
  releaseTimeCount?: number;
}

/** fixture 한 개의 metadata (tests/fixtures/live/<source>/<name>.json) */
export interface FixtureMeta {
  source: "ebsi" | "kice" | "education_office";
  /** exam_list · exam_detail · exam_release_index · listening_archive · schedule */
  pageType?: PageType;
  /** @deprecated pageType 을 쓴다. listing→exam_list(+자료), board-list→exam_list, board-detail→exam_detail */
  kind?: LegacyFixtureKind;
  url: string;
  capturedAt: string;
  sha256: string;
  /** 저장 당시 parser 버전 */
  parserVersion?: string;
  /** @deprecated parserVersion */
  parserVersionAtCapture?: string;
  /** 시험 하나에 대한 페이지면 그 시험 (상세/공개시각/듣기 페이지). 목록이면 null */
  examIdentity?: ExamIdentity | null;
  /** parser 에 필요한 맥락 */
  context?: {
    grade?: Grade;
    year?: number;
    examTitle?: string;
    examDate?: string;
    /** EBSi 자료 페이지에서 특정 시험을 고를 때 */
    externalId?: string;
  };
  expected?: FixtureExpectation;
  /** 사람이 실제 페이지와 expected 를 대조해 확인했는지. false 면 검증 증거로 쓰지 않는다 */
  expectedReviewed?: boolean;
  /** @deprecated expected */
  expect?: { empty?: boolean; minExams?: number; minArtifacts?: number };
}

/**
 * parser contract: 모든 source parser 가 돌려줘야 하는 필수 field.
 * 하나라도 빠지거나 형식이 틀리면 contract 위반이다.
 */
export interface ContractRecord {
  year: number;
  grade: number;
  month: number;
  examType: string;
  subject: string | null;
  course: string | null;
  courseStatus: "none" | "resolved" | "ambiguous" | null;
  artifactType: string | null;
  artifactUrl: string | null;
}

export interface FixtureSummary {
  examCount: number;
  subjects: string[];
  courses: string[];
  artifactCount: number;
  releaseTimeCount: number;
}

export interface ContractResult {
  ok: boolean;
  records: ContractRecord[];
  exams: number;
  artifacts: number;
  ambiguousCourses: number;
  summary: FixtureSummary;
  /** expected 와 다른 점 (구조 변경 가능성) */
  drift: string[];
  errors: string[];
}

export function pageTypeOf(meta: FixtureMeta): PageType {
  if (meta.pageType) return meta.pageType;
  if (meta.kind === "board-detail") return "exam_detail";
  return "exam_list";
}

function expectationOf(meta: FixtureMeta): FixtureExpectation {
  if (meta.expected) return meta.expected;
  const legacy = meta.expect ?? {};
  return {
    empty: legacy.empty,
    minimumExamCount: legacy.minExams,
    minimumArtifactCount: legacy.minArtifacts,
  };
}

function artifactRecord(exam: CanonicalExam | ExamIdentity, a: DiscoveredArtifact): ContractRecord {
  return {
    year: exam.year,
    grade: exam.grade,
    month: exam.month,
    examType: exam.examType,
    subject: a.subject,
    course: a.course.status === "resolved" ? a.course.code : null,
    courseStatus: a.course.status,
    artifactType: a.type,
    artifactUrl: a.url,
  };
}

function examOnly(exam: CanonicalExam | ExamIdentity): ContractRecord {
  return {
    year: exam.year,
    grade: exam.grade,
    month: exam.month,
    examType: exam.examType,
    subject: null,
    course: null,
    courseStatus: null,
    artifactType: null,
    artifactUrl: null,
  };
}

/** 시험 하나에 대한 페이지의 identity: metadata(examIdentity) → context.examTitle → 페이지가 알려준 값 */
function singleExamIdentity(
  meta: FixtureMeta,
  parsed: CanonicalExam | null,
): { exam: CanonicalExam | ExamIdentity; errors: string[] } {
  const errors: string[] = [];
  let declared: CanonicalExam | ExamIdentity | null = meta.examIdentity ?? null;
  if (!declared && meta.context?.examTitle) {
    const c = canonicalizeExamTitle(meta.context.examTitle);
    if (!c.ok) throw new Error(`context.examTitle not recognized: ${c.reason}`);
    declared = c.exam;
  }
  if (declared && parsed && canonicalKey(declared) !== canonicalKey(parsed)) {
    errors.push(
      `page shows exam ${canonicalKey(parsed)} but metadata says ${canonicalKey(declared)}`,
    );
  }
  const exam = declared ?? parsed;
  if (!exam) throw new Error("exam identity unknown: set examIdentity or context.examTitle");
  return { exam, errors };
}

export interface ParserRun {
  records: ContractRecord[];
  releaseTimeCount: number;
  errors: string[];
}

/** fixture HTML 을 pageType 에 맞는 source parser 에 통과시킨다 (네트워크 없음) */
export function runParser(html: string, meta: FixtureMeta): ParserRun {
  const pageType = pageTypeOf(meta);
  const out: ParserRun = { records: [], releaseTimeCount: 0, errors: [] };

  if (pageType === "listening_archive") {
    const parsed = parseListeningArchive(html, {
      pageUrl: meta.url,
      examTitle: meta.context?.examTitle,
    });
    const { exam, errors } = singleExamIdentity(meta, parsed.exam);
    out.errors.push(...errors);
    out.records = parsed.artifacts.map((a) => artifactRecord(exam, a));
    return out;
  }
  if (pageType === "schedule") {
    throw new Error("no schedule parser is implemented yet (needs a live fixture first)");
  }

  if (meta.source === "ebsi") {
    const grade = meta.context?.grade ?? meta.examIdentity?.grade;
    const year = meta.context?.year ?? meta.examIdentity?.year;
    if (!grade || !year) throw new Error("ebsi fixtures need context.grade and context.year");
    if (pageType === "exam_list") {
      const { exams } = parseEbsiListing(html, { pageUrl: meta.url, grade, year });
      out.records = exams.flatMap((e) =>
        e.artifacts.length
          ? e.artifacts.map((a) => artifactRecord(e.canonical, a))
          : [examOnly(e.canonical)],
      );
      return out;
    }
    if (pageType === "exam_detail") {
      const externalId = meta.context?.externalId;
      if (!externalId) throw new Error("ebsi exam_detail fixtures need context.externalId");
      const { artifacts, found } = parseEbsiExamArtifacts(html, {
        pageUrl: meta.url,
        grade,
        year,
        externalId,
      });
      if (!found) out.errors.push(`exam ${externalId} not found on the page`);
      const { exam, errors } = singleExamIdentity(meta, null);
      out.errors.push(...errors);
      out.records = artifacts.map((a) => artifactRecord(exam, a));
      return out;
    }
    throw new Error(`ebsi has no parser for pageType ${pageType}`);
  }

  if (pageType === "exam_release_index") {
    if (meta.source !== "kice") throw new Error("exam_release_index is a KICE page type");
    const parsed = parseKiceExamIndex(html, {
      pageUrl: meta.url,
      examTitle: meta.context?.examTitle,
      examDate: meta.context?.examDate,
    });
    const { exam, errors } = singleExamIdentity(meta, parsed.exam);
    out.errors.push(...errors);
    out.records = parsed.artifacts.map((a) => artifactRecord(exam, a));
    out.releaseTimeCount = parsed.releaseTimes.length;
    return out;
  }

  const definition = meta.source === "kice" ? KICE_DEFINITION : EDUCATION_OFFICE_DEFINITION;
  if (pageType === "exam_list") {
    out.records = parseBoardList(html, definition.structure, { pageUrl: meta.url }).exams.map(
      (e) => ({ ...examOnly(e.canonical), artifactUrl: e.sourceUrl }),
    );
    return out;
  }
  const { exam, errors } = singleExamIdentity(meta, null);
  out.errors.push(...errors);
  out.records = parseBoardAttachments(html, definition.structure, { pageUrl: meta.url }).map((a) =>
    artifactRecord(exam, a),
  );
  return out;
}

/** 호환용: 레코드만 */
export function runParserOnFixture(html: string, meta: FixtureMeta): ContractRecord[] {
  return runParser(html, meta).records;
}

export function summarize(records: ContractRecord[], releaseTimeCount = 0): FixtureSummary {
  return {
    examCount: new Set(records.map((r) => `${r.year}-${r.grade}-${r.month}-${r.examType}`)).size,
    subjects: [...new Set(records.map((r) => r.subject).filter((s): s is string => !!s))].sort(),
    courses: [...new Set(records.map((r) => r.course).filter((c): c is string => !!c))].sort(),
    artifactCount: records.filter((r) => r.artifactType).length,
    releaseTimeCount,
  };
}

/** expected 와 실제 요약 비교 → 다르면 "구조 변경 가능성" 메시지 */
export function compareSummary(summary: FixtureSummary, expected: FixtureExpectation): string[] {
  const drift: string[] = [];
  const prefix = "구조 변경 가능성:";
  if (expected.empty) {
    if (summary.examCount > 0 || summary.artifactCount > 0)
      drift.push(`${prefix} expected an empty page but parsed ${summary.examCount} exams`);
    return drift;
  }
  if (expected.examCount !== undefined && summary.examCount !== expected.examCount)
    drift.push(`${prefix} examCount ${summary.examCount} (기록 ${expected.examCount})`);
  const minExams = expected.minimumExamCount ?? (expected.examCount === undefined ? 1 : 0);
  if (summary.examCount < minExams)
    drift.push(`${prefix} parsed ${summary.examCount} exams, expected at least ${minExams}`);
  for (const s of expected.containsSubjects ?? [])
    if (!summary.subjects.includes(s)) drift.push(`${prefix} 영역 "${s}" 이 사라짐`);
  for (const c of expected.containsCourses ?? [])
    if (!summary.courses.includes(c)) drift.push(`${prefix} 세부과목 "${c}" 이 사라짐`);
  if (
    expected.minimumArtifactCount !== undefined &&
    summary.artifactCount < expected.minimumArtifactCount
  )
    drift.push(
      `${prefix} parsed ${summary.artifactCount} artifacts, expected at least ${expected.minimumArtifactCount}`,
    );
  if (
    expected.releaseTimeCount !== undefined &&
    summary.releaseTimeCount !== expected.releaseTimeCount
  )
    drift.push(
      `${prefix} 공개 시각 ${summary.releaseTimeCount}개 (기록 ${expected.releaseTimeCount})`,
    );
  return drift;
}

/** 레코드마다 필수 field 와 형식을 확인하고, 기대 요약과 비교한다 */
export function checkContract(
  records: ContractRecord[],
  meta: FixtureMeta,
  releaseTimeCount = 0,
): ContractResult {
  const errors: string[] = [];
  const pageType = pageTypeOf(meta);
  const allowed = BUILTIN_SOURCES.find((s) => s.id === meta.source)?.allowedHosts ?? [];
  const isBoardList = pageType === "exam_list" && meta.source !== "ebsi";
  records.forEach((r, i) => {
    const at = `record #${i + 1}`;
    if (!Number.isInteger(r.year) || r.year < 2000 || r.year > 2100)
      errors.push(`${at}: year missing/invalid`);
    if (![1, 2, 3].includes(r.grade)) errors.push(`${at}: grade missing/invalid`);
    if (!Number.isInteger(r.month) || r.month < 1 || r.month > 12)
      errors.push(`${at}: month missing/invalid`);
    if (!(EXAM_TYPES as readonly string[]).includes(r.examType))
      errors.push(`${at}: examType missing/invalid`);
    const isArtifact = !isBoardList && r.artifactType !== null;
    if (isBoardList || isArtifact) {
      if (!r.artifactUrl) errors.push(`${at}: url missing`);
      else {
        try {
          const u = new URL(r.artifactUrl);
          if (!/^https?:$/.test(u.protocol)) errors.push(`${at}: url is not http(s)`);
          if (allowed.length && !isHostAllowed(u.hostname, allowed)) {
            errors.push(`${at}: url host ${u.hostname} is not in the ${meta.source} allowlist`);
          }
        } catch {
          errors.push(`${at}: url is not absolute`);
        }
      }
    }
    if (isArtifact) {
      if (!r.subject || !(SUBJECTS as readonly string[]).includes(r.subject))
        errors.push(`${at}: subject missing/invalid`);
      if (!r.artifactType || !(FILE_TYPES as readonly string[]).includes(r.artifactType))
        errors.push(`${at}: artifactType missing/invalid`);
      if (r.course !== null && !isCourseCode(r.course))
        errors.push(`${at}: course "${r.course}" is not a catalog code`);
      if (r.courseStatus === null) errors.push(`${at}: courseStatus missing`);
    }
  });

  const summary = summarize(records, releaseTimeCount);
  const drift = compareSummary(summary, expectationOf(meta));
  return {
    ok: errors.length === 0 && drift.length === 0,
    records,
    exams: summary.examCount,
    artifacts: summary.artifactCount,
    ambiguousCourses: records.filter((r) => r.courseStatus === "ambiguous").length,
    summary,
    drift,
    errors: [...errors, ...drift],
  };
}

/** 파싱 자체가 실패(SourceStructureChangedError 등)해도 contract 결과로 돌려준다 */
export function validateFixture(html: string, meta: FixtureMeta): ContractResult {
  try {
    const run = runParser(html, meta);
    const result = checkContract(run.records, meta, run.releaseTimeCount);
    if (run.errors.length) {
      result.errors.unshift(...run.errors);
      result.ok = false;
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      records: [],
      exams: 0,
      artifacts: 0,
      ambiguousCourses: 0,
      summary: summarize([]),
      drift: [],
      errors: [`parser failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
