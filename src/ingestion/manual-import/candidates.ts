import { courseByCode } from "@/lib/courses";
import { regimeFor } from "@/lib/regimes";
import type { FileType, Subject } from "@/lib/constants";
import { applyRegime, resolveCourse } from "../canonical/course";
import {
  GRADE_DEPENDENT_CODES,
  isAmbiguousVariant,
  parseEbsiFileUrl,
  WHOLE_SUBJECT_CODES,
  type EbsiFile,
} from "./ebsi-file";
import type { ReviewEvidence, ReviewReasonCode } from "./evidence";
import type { MappingRule } from "./review";

/**
 * 공개 색인 결과(검색엔진 등)에서 발견된 공식 URL → 운영자 CSV 후보.
 *
 * - URL 을 만들거나 고치지 않는다. 입력 URL 을 그대로 쓴다.
 * - 연·월·학년은 공식 경로에서, 자료 종류는 파일명에서. 경로 날짜는 같은 날짜 경로의 제목 중 하나라도
 *   그 월(또는 수능)을 말해야 인정한다 (게시일이 섞여 있다).
 * - 세부과목은 (1) 그 파일 제목 (2) 관리자가 승인한 규칙 (3) 같은 코드의 다른 제목들이 한목소리일 때만 정한다.
 * - 확실하지 않으면 held(보류) — CSV 에 넣지 않는다. 결과는 모두 manual_review 로 들어가고 게시는 관리자 승인 후.
 */

export interface FoundEntry {
  url: string;
  title?: string;
  query?: string;
}

export interface CandidateRow {
  year: number;
  grade: number;
  month: number;
  exam_type: "school_mock" | "kice_mock" | "csat";
  exam_date: string;
  organizer: string;
  subject: Subject;
  course_code: string;
  file_type: FileType;
  official_url: string;
  original_file_name: string;
  source_label: string;
  /** 참고용 점수 (0~100). 결정은 규칙으로 하고, 점수는 검토 우선순위용이다 */
  score: number;
  evidence: ReviewEvidence[];
}

export interface HeldCandidate {
  url: string;
  reasonCode: ReviewReasonCode;
  reason: string;
  evidence: ReviewEvidence[];
}

export interface CandidateResult {
  rows: CandidateRow[];
  held: HeldCandidate[];
}

const TYPE_KO: Record<string, string> = {
  question: "문제",
  solution: "정답 및 해설",
  listening_audio: "영어 듣기 음원",
  listening_script: "영어 듣기 대본",
};
const AREA_KO: Record<string, string> = {
  korean: "국어",
  math: "수학",
  english: "영어",
  history: "한국사",
  social: "사회탐구",
  science: "과학탐구",
  vocational: "직업탐구",
  second_language: "제2외국어/한문",
};

export function areaOfCode(code: string): Subject | null {
  if (code in WHOLE_SUBJECT_CODES) return WHOLE_SUBJECT_CODES[code]!;
  if (code === "his" || code === "s_his") return "history";
  if (code.startsWith("s_") || code === "sat") return "social";
  if (code.startsWith("g_") || code === "gat") return "science";
  if (code.startsWith("J_")) return "vocational";
  if (code.startsWith("2nd_")) return "second_language";
  return null;
}

export function examTypeFor(grade: number, month: number): CandidateRow["exam_type"] {
  if (grade === 3 && month === 11) return "csat";
  if (grade === 3 && (month === 6 || month === 9)) return "kice_mock";
  return "school_mock";
}

const COURSE_AREAS = new Set<Subject>(["social", "science", "vocational", "second_language"]);

function titleCourse(
  title: string,
  subject: Subject,
  exam: { year: number; grade: number },
): string | null {
  if (!title) return null;
  const regime = regimeFor(exam).code;
  const r = applyRegime(resolveCourse(title, { subject, regime }), exam);
  return r.status === "resolved" ? r.code : null;
}

function monthConfirmed(month: number, titles: string[]): boolean {
  return titles.some(
    (t) =>
      [...t.matchAll(/(\d{1,2})\s*월/g)].some((m) => Number(m[1]) === month) ||
      (month === 11 && t.includes("대학수학능력시험") && !t.includes("모의평가")),
  );
}

const ruleKey = (f: EbsiFile) =>
  GRADE_DEPENDENT_CODES.has(f.code) ? `${f.code}|go${f.grade}` : `${f.code}|`;

export function buildCandidates(
  found: FoundEntry[],
  options: { year?: number; rules?: Map<string, MappingRule> } = {},
): CandidateResult {
  const titles = new Map<string, Set<string>>();
  const firstSeen = new Map<string, FoundEntry>();
  for (const e of found) {
    const url = e.url?.trim();
    if (!url) continue;
    if (!firstSeen.has(url)) firstSeen.set(url, e);
    if (!titles.has(url)) titles.set(url, new Set());
    if (e.title) titles.get(url)!.add(e.title);
  }
  const files = [...firstSeen.keys()].map((url) => ({ url, f: parseEbsiFileUrl(url) }));
  const held: HeldCandidate[] = [];
  const searchEvidence = (url: string): ReviewEvidence[] => {
    const e = firstSeen.get(url)!;
    return [{ kind: "search_result", query: e.query ?? "", title: e.title ?? "" }];
  };
  const hold = (url: string, reasonCode: ReviewReasonCode, reason: string) =>
    held.push({ url, reasonCode, reason, evidence: searchEvidence(url) });

  // 경로 날짜 → 그 날짜 경로의 모든 제목
  const dateTitles = new Map<string, string[]>();
  for (const { url, f } of files) {
    if (!f) continue;
    dateTitles.set(f.pathDate, [...(dateTitles.get(f.pathDate) ?? []), ...(titles.get(url) ?? [])]);
  }
  // 같은 코드(학년 의존 코드는 고1 학년별)의 제목 투표 — 코드의 뜻을 정하는 단계라 체제 검증 없이 카탈로그로 판정.
  // 대상 시험의 체제 검증은 아래에서 따로 한다. 고2·3 sat/gat 는 파일마다 과목이 달라 투표하지 않는다.
  const votes = new Map<string, Map<string, number>>();
  for (const { url, f } of files) {
    if (!f) continue;
    const area = areaOfCode(f.code);
    if (!area || !COURSE_AREAS.has(area)) continue;
    if (GRADE_DEPENDENT_CODES.has(f.code) && (f.grade !== 1 || f.month === 3)) continue;
    for (const t of titles.get(url) ?? []) {
      const r = resolveCourse(t, { subject: area });
      if (r.status !== "resolved") continue;
      const v = votes.get(ruleKey(f)) ?? new Map<string, number>();
      v.set(r.code, (v.get(r.code) ?? 0) + 1);
      votes.set(ruleKey(f), v);
    }
  }

  type Picked = { f: EbsiFile; subject: Subject; course: string; via: string; score: number };
  const slots = new Map<string, Picked[]>();
  for (const { url, f } of files) {
    if (!f) {
      hold(url, "other", "EBSi 공식 파일 경로 형식이 아님 — 운영자가 직접 확인해 입력");
      continue;
    }
    if (options.year && f.year !== options.year) continue;
    const ts = [...(titles.get(url) ?? [])];
    if (!monthConfirmed(f.month, dateTitles.get(f.pathDate) ?? [])) {
      hold(url, "exam_month_unconfirmed", `경로 날짜 ${f.pathDate} 의 월을 말하는 제목이 없음`);
      continue;
    }
    if (f.kind === "paper_even" || f.kind === "answer_key") {
      hold(
        url,
        "secondary_document",
        f.kind === "paper_even" ? "짝수형 문제지 (홀수형만 게시)" : "정답표 (정답 및 해설 우선)",
      );
      continue;
    }
    if (f.kind === "unknown") {
      hold(url, "other", "파일명에서 자료 종류를 판별할 수 없음");
      continue;
    }
    if (isAmbiguousVariant(f.code)) {
      hold(url, "ambiguous_variant", `'${f.code}' — 선택과목 구분 미확인`);
      continue;
    }
    const subject = areaOfCode(f.code);
    if (!subject) {
      hold(url, "course_unconfirmed", `과목 코드 '${f.code}' 를 알 수 없음`);
      continue;
    }
    if ((f.kind === "listening_audio" || f.kind === "listening_script") && subject !== "english") {
      hold(url, "other", "영어 외 듣기 자료");
      continue;
    }
    if (f.kind !== "solution" && ts.some((t) => /정답\s*(및|과)\s*해설/.test(t))) {
      hold(url, "type_mismatch", "제목은 정답 및 해설인데 파일명은 다른 종류");
      continue;
    }

    let course = "";
    let via = "whole_subject";
    let score = 50;
    if (COURSE_AREAS.has(subject)) {
      const own = ts.map((t) => titleCourse(t, subject, f)).find(Boolean);
      const rule = options.rules?.get(ruleKey(f));
      const vote = votes.get(ruleKey(f));
      if (own) {
        course = own;
        via = "own_title";
        score = 90;
      } else if (rule && rule.subject === subject && rule.courseCode) {
        course = rule.courseCode;
        via = `approved_rule(${rule.approvals})`;
        score = 80;
      } else if (
        vote &&
        vote.size === 1 &&
        (!GRADE_DEPENDENT_CODES.has(f.code) || (f.grade === 1 && f.month !== 3))
      ) {
        course = [...vote.keys()][0]!;
        via = "code_vote";
        score = 70;
      } else if (GRADE_DEPENDENT_CODES.has(f.code) && f.grade === 1 && f.month === 3) {
        hold(
          url,
          "subject_mismatch",
          "고1 3월 탐구는 중학 과정(통합사회·통합과학 아님) — 확인 필요",
        );
        continue;
      } else {
        hold(
          url,
          "course_unconfirmed",
          `'${f.code}' 의 세부과목을 제목·승인 규칙으로 확인할 수 없음`,
        );
        continue;
      }
      // 규칙·투표로 정한 과목도 시험 체제에 있는 과목이어야 한다
      if (
        via !== "own_title" &&
        titleCourse(courseByCode(course)?.name ?? "", subject, f) !== course
      ) {
        hold(url, "course_unconfirmed", `${course} 는 ${f.year} 고${f.grade} 체제에 없는 세부과목`);
        continue;
      }
    } else if (subject === "history") {
      via = "history_code";
    }
    if (ts.some((t) => /정답\s*(및|과)\s*해설|문제지/.test(t))) score = Math.min(100, score + 10);
    const key = [f.year, f.grade, f.month, subject, course, f.kind].join("|");
    slots.set(key, [...(slots.get(key) ?? []), { f, subject, course, via, score }]);
  }

  const rows: CandidateRow[] = [];
  for (const picked of slots.values()) {
    const ids = new Set(picked.map((p) => p.f.fileId));
    if (ids.size > 1) {
      for (const p of picked)
        hold(
          p.f.url,
          "slot_conflict",
          `같은 슬롯에 서로 다른 파일 ${ids.size}개 — 운영자 선택 필요`,
        );
      continue;
    }
    picked.sort((a, b) =>
      a.f.part === "" ? -1 : b.f.part === "" ? 1 : a.f.part.localeCompare(b.f.part),
    );
    const [p, ...rest] = picked as [Picked, ...Picked[]];
    for (const r of rest)
      hold(r.f.url, "duplicate_file", `같은 파일 ID 의 다른 번호 — ${p.f.name} 채택`);
    const et = examTypeFor(p.f.grade, p.f.month);
    const what = p.course ? (courseByCode(p.course)?.name ?? p.course) : AREA_KO[p.subject];
    rows.push({
      year: p.f.year,
      grade: p.f.grade,
      month: p.f.month,
      exam_type: et,
      exam_date: p.f.pathDate,
      organizer: et === "school_mock" ? "" : "한국교육과정평가원",
      subject: p.subject,
      course_code: p.course,
      file_type: p.f.kind as FileType,
      official_url: p.f.url,
      original_file_name: `${p.f.name}.${p.f.ext}`,
      source_label: `EBSi ${p.f.year}년 ${p.f.month}월 고${p.f.grade} ${
        et === "csat" ? "수능" : et === "kice_mock" ? "모의평가" : "학력평가"
      } ${what} ${TYPE_KO[p.f.kind] ?? p.f.kind}`,
      score: p.score,
      evidence: [
        ...searchEvidence(p.f.url),
        { kind: "classification", via: p.via, score: p.score },
      ],
    });
  }
  rows.sort(
    (a, b) =>
      a.year - b.year ||
      a.grade - b.grade ||
      a.month - b.month ||
      a.subject.localeCompare(b.subject) ||
      a.course_code.localeCompare(b.course_code) ||
      a.file_type.localeCompare(b.file_type),
  );
  return { rows, held };
}

export const CANDIDATE_CSV_COLUMNS = [
  "year",
  "grade",
  "month",
  "exam_type",
  "exam_date",
  "organizer",
  "subject",
  "course_code",
  "file_type",
  "official_url",
  "original_file_name",
  "source_label",
] as const;

export function candidatesToCsv(rows: CandidateRow[]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    CANDIDATE_CSV_COLUMNS.join(","),
    ...rows.map((r) => CANDIDATE_CSV_COLUMNS.map((c) => esc(r[c])).join(",")),
  ].join("\n");
}
