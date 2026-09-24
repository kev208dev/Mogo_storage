import { EXAM_TYPES, FILE_TYPES, SUBJECTS } from "../../lib/constants";
import { isCourseCode } from "../../lib/courses";
import { canonicalizeExamTitle } from "../canonical/exam-title";
import { isHostAllowed } from "../net/url-policy";
import { parseBoardAttachments, parseBoardList } from "../sources/board/parser";
import { BUILTIN_SOURCES } from "../sources/config";
import { EDUCATION_OFFICE_DEFINITION } from "../sources/education-office/structure";
import { parseEbsiListing } from "../sources/ebsi/parser";
import { KICE_DEFINITION } from "../sources/kice/structure";
import type { CanonicalExam, DiscoveredArtifact } from "../types";

/** fixture 한 개의 metadata (tests/fixtures/live/<source>/<name>.json) */
export interface FixtureMeta {
  source: "ebsi" | "kice" | "education_office";
  /** listing: EBSi 목록 / board-list: 게시판 목록 / board-detail: 게시글 첨부파일 */
  kind: "listing" | "board-list" | "board-detail";
  url: string;
  capturedAt: string;
  sha256: string;
  parserVersionAtCapture?: string;
  /** listing 해석에 필요한 맥락 */
  context?: { grade?: 1 | 2 | 3; year?: number; examTitle?: string };
  /** 기대치: 비어 있는 페이지인지, 최소 몇 건이 나와야 하는지 */
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

export interface ContractResult {
  ok: boolean;
  records: ContractRecord[];
  exams: number;
  artifacts: number;
  ambiguousCourses: number;
  errors: string[];
}

function artifactRecord(exam: CanonicalExam, a: DiscoveredArtifact): ContractRecord {
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

/** fixture HTML 을 해당 source parser 에 통과시킨다 (네트워크 없음) */
export function runParserOnFixture(html: string, meta: FixtureMeta): ContractRecord[] {
  if (meta.kind === "listing") {
    if (meta.source !== "ebsi") throw new Error(`listing fixtures are only supported for ebsi`);
    const grade = meta.context?.grade;
    const year = meta.context?.year;
    if (!grade || !year) throw new Error("listing fixture needs context.grade and context.year");
    const { exams } = parseEbsiListing(html, { pageUrl: meta.url, grade, year });
    return exams.flatMap((e) =>
      e.artifacts.length
        ? e.artifacts.map((a) => artifactRecord(e.canonical, a))
        : [{ ...examOnly(e.canonical) }],
    );
  }
  const definition = meta.source === "kice" ? KICE_DEFINITION : EDUCATION_OFFICE_DEFINITION;
  if (meta.kind === "board-list") {
    return parseBoardList(html, definition.structure, { pageUrl: meta.url }).exams.map((e) => ({
      ...examOnly(e.canonical),
      artifactUrl: e.sourceUrl,
    }));
  }
  const title = meta.context?.examTitle;
  if (!title) throw new Error("board-detail fixture needs context.examTitle");
  const canonical = canonicalizeExamTitle(title);
  if (!canonical.ok) throw new Error(`context.examTitle not recognized: ${canonical.reason}`);
  return parseBoardAttachments(html, definition.structure, { pageUrl: meta.url }).map((a) =>
    artifactRecord(canonical.exam, a),
  );
}

function examOnly(exam: CanonicalExam): ContractRecord {
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

/** 레코드마다 필수 field 와 형식을 확인한다 */
export function checkContract(records: ContractRecord[], meta: FixtureMeta): ContractResult {
  const errors: string[] = [];
  const allowed = BUILTIN_SOURCES.find((s) => s.id === meta.source)?.allowedHosts ?? [];
  records.forEach((r, i) => {
    const at = `record #${i + 1}`;
    if (!Number.isInteger(r.year) || r.year < 2000 || r.year > 2100)
      errors.push(`${at}: year missing/invalid`);
    if (![1, 2, 3].includes(r.grade)) errors.push(`${at}: grade missing/invalid`);
    if (!Number.isInteger(r.month) || r.month < 1 || r.month > 12)
      errors.push(`${at}: month missing/invalid`);
    if (!(EXAM_TYPES as readonly string[]).includes(r.examType))
      errors.push(`${at}: examType missing/invalid`);
    const isArtifact = meta.kind !== "board-list" && r.artifactType !== null;
    if (meta.kind === "board-list" || isArtifact) {
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

  const exams = new Set(records.map((r) => `${r.year}-${r.grade}-${r.month}-${r.examType}`)).size;
  const artifacts = records.filter((r) => r.artifactType).length;
  const expect = meta.expect ?? {};
  if (expect.empty) {
    if (records.length) errors.push(`expected an empty page but parsed ${records.length} records`);
  } else {
    if (exams < (expect.minExams ?? 1))
      errors.push(`parsed ${exams} exams, expected at least ${expect.minExams ?? 1}`);
    if (expect.minArtifacts && artifacts < expect.minArtifacts) {
      errors.push(`parsed ${artifacts} artifacts, expected at least ${expect.minArtifacts}`);
    }
  }
  return {
    ok: errors.length === 0,
    records,
    exams,
    artifacts,
    ambiguousCourses: records.filter((r) => r.courseStatus === "ambiguous").length,
    errors,
  };
}

/** 파싱 자체가 실패(SourceStructureChangedError 등)해도 contract 결과로 돌려준다 */
export function validateFixture(html: string, meta: FixtureMeta): ContractResult {
  try {
    return checkContract(runParserOnFixture(html, meta), meta);
  } catch (error) {
    return {
      ok: false,
      records: [],
      exams: 0,
      artifacts: 0,
      ambiguousCourses: 0,
      errors: [`parser failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
