import type { Subject } from "../../lib/constants";
import { GRADE_DEPENDENT_CODES, parseEbsiFileUrl } from "../manual-import/ebsi-file";
import { headerConflicts, type ExamIdentity } from "./identity";
import { parseAnswerKeyText, parsePointsText, type AnswerEntry } from "./parse";
import { checkAnswerKey, checkPoints, pointsRule, QUESTION_COUNT } from "./validate";

/** 파서 규칙이 바뀌면 올린다 — 이전 버전으로 추출한 슬롯은 다시 추출 대상이 된다 (v3: 문항 머리말 제목 → 개념 태그) */
export const ANSWER_KEY_PARSER_VERSION = "answer-key-v3";

export interface SolutionDoc {
  fileId: string;
  /** exam_files.course_id 의 code (영역 전체 자료면 null) */
  courseCode: string | null;
  url: string | null;
  sha256: string | null;
  pages: readonly string[];
}
export interface PaperDoc {
  fileId: string;
  courseCode: string | null;
  url?: string | null;
  pages: readonly string[];
}

/**
 * EBSi 파일명 코드로 문제지 ↔ 해설이 같은 시험·과목인지 확인 (둘 다 EBSi 파일일 때만).
 * 국어·수학 선택 과목 파일(korA, mathB)은 영역 코드(kor, math)로 비교한다.
 */
export function ebsiPairConflict(solutionUrl: string | null, paperUrl: string | null | undefined) {
  if (!solutionUrl || !paperUrl) return null;
  const a = parseEbsiFileUrl(solutionUrl);
  const b = parseEbsiFileUrl(paperUrl);
  if (!a || !b) return null;
  // s_his ↔ his, korA ↔ kor. 학년마다 뜻이 다른 범용 코드(sat/gat)는 비교하지 않는다
  const family = (code: string) => code.replace(/^[sg]_/, "").replace(/^(kor|math)[A-Z]$/, "$1");
  if (GRADE_DEPENDENT_CODES.has(a.code) || GRADE_DEPENDENT_CODES.has(b.code)) return null;
  if (a.pathDate !== b.pathDate || a.grade !== b.grade)
    return `문제지(${b.pathDate} 고${b.grade})와 해설(${a.pathDate} 고${a.grade}) 시험이 다름`;
  if (family(a.code) !== family(b.code))
    return `문제지 코드 ${b.code} 와 해설 코드 ${a.code} 가 다름`;
  return null;
}

export interface Reason {
  code: string;
  detail: string;
}

export interface SlotAnswerKey {
  /** null = 공통 또는 영역 전체 */
  courseCode: string | null;
  entries: AnswerEntry[];
  answersVerified: boolean;
  /** 문항 번호 → 배점. 검증된 문제지가 없으면 null */
  points: Map<number, number> | null;
  reasons: Reason[];
  crossChecked: number;
  solutionFileId: string;
  questionFileId: string | null;
  solutionUrl: string | null;
  solutionSha256: string | null;
}

const key = (code: string | null) => code ?? "";
const sameAnswers = (a: AnswerEntry[], b: AnswerEntry[]) =>
  a.length === b.length &&
  a.every(
    (e, i) => e.number === b[i]!.number && e.answer === b[i]!.answer && e.choice === b[i]!.choice,
  );

/**
 * 한 시험·영역의 정답·해설 PDF 들과 문제지들 → 슬롯별 정답표 + 배점.
 * 같은 슬롯이 여러 파일에 있으면 모두 같아야 한다. 하나라도 다르면 그 슬롯은 검증 실패.
 */
export function assembleAnswerKeys(
  exam: ExamIdentity,
  subject: Subject,
  solutions: readonly SolutionDoc[],
  papers: readonly PaperDoc[],
): SlotAnswerKey[] {
  const slots = new Map<string, SlotAnswerKey>();
  let commonCount: number | null = null;

  for (const doc of solutions) {
    const parsed = parseAnswerKeyText(doc.pages);
    const check = checkAnswerKey(parsed, subject);
    const sectioned = parsed.sections.some((s) => s.kind === "elective");
    for (const detail of headerConflicts(doc.pages, {
      exam,
      subject,
      courseCode: sectioned ? null : doc.courseCode,
    })) {
      check.reasons.push({ code: "solution_identity", detail });
      check.ok = false;
    }
    if (sectioned) {
      const base = check.sections.find((s) => s.courseCode === null);
      if (base) commonCount = base.entries.length;
    }
    const produced = check.sections.map((s) => ({
      // 공통/선택 구분이 없는 정답표는 파일의 세부과목 슬롯 (예: 사회·문화 정답 → social-culture)
      courseCode: sectioned ? s.courseCode : doc.courseCode,
      entries: [...s.entries].sort((a, b) => a.number - b.number),
    }));
    if (!produced.length)
      produced.push({ courseCode: sectioned ? null : doc.courseCode, entries: [] });

    for (const p of produced) {
      const existing = slots.get(key(p.courseCode));
      const ownCross = p.entries.filter((e) => e.marker !== null && e.marker === e.answer).length;
      if (!existing) {
        slots.set(key(p.courseCode), {
          courseCode: p.courseCode,
          entries: p.entries,
          answersVerified: check.ok,
          points: null,
          reasons: [...check.reasons],
          crossChecked: ownCross,
          solutionFileId: doc.fileId,
          questionFileId: null,
          solutionUrl: doc.url,
          solutionSha256: doc.sha256,
        });
        continue;
      }
      if (!check.ok) {
        existing.reasons.push(...check.reasons);
        existing.answersVerified = false;
      } else if (!sameAnswers(existing.entries, p.entries)) {
        existing.reasons.push({
          code: "file_conflict",
          detail: "같은 슬롯의 정답이 해설 파일마다 다름",
        });
        existing.answersVerified = false;
      } else {
        existing.crossChecked = Math.max(existing.crossChecked, ownCross);
        // 페이지는 처음 파일 기준 (다른 파일은 교차 확인용)
      }
    }
  }

  // ── 배점: 문제지 한 부 = 1번 ~ 마지막 번호 (공통 + 선택 하나, 또는 영역 전체)
  const total = QUESTION_COUNT[subject];
  const commonPoints: Array<{ fileId: string; points: Map<number, number> }> = [];
  // 여러 슬롯이 같은 문제지 파일을 가리키면(선택 과목 전부가 들어 있는 통합 문제지) 선택 부분이
  // 어느 과목인지 확정할 수 없다 → 공통 배점에만 쓴다. 과목이 없는 문제지도 마찬가지.
  const usage = new Map<string, number>();
  for (const p of papers) if (p.url) usage.set(p.url, (usage.get(p.url) ?? 0) + 1);
  for (const paper of papers) {
    const combined = !paper.courseCode || (paper.url ? (usage.get(paper.url) ?? 0) > 1 : false);
    const { points, found } = parsePointsText(paper.pages, pointsRule(subject).base);
    const check = checkPoints(points, found, subject);
    for (const detail of headerConflicts(paper.pages, {
      exam,
      subject,
      courseCode: commonCount === null ? paper.courseCode : null,
    })) {
      check.reasons.push({ code: "identity", detail });
      check.ok = false;
    }
    const targets =
      commonCount !== null
        ? [
            { code: null as string | null, from: 1, to: commonCount },
            ...(combined ? [] : [{ code: paper.courseCode, from: commonCount + 1, to: total }]),
          ]
        : [{ code: paper.courseCode, from: 1, to: total }];
    for (const t of targets) {
      const slot = slots.get(key(t.code));
      if (!slot) continue;
      const pair = ebsiPairConflict(slot.solutionUrl, paper.url);
      if (pair) {
        slot.reasons.push({ code: "points_identity", detail: pair });
        continue;
      }
      if (!check.ok) {
        slot.reasons.push(
          ...check.reasons.map((r) => ({ code: `points_${r.code}`, detail: r.detail })),
        );
        continue;
      }
      const part = new Map([...points].filter(([n]) => n >= t.from && n <= t.to));
      if (t.code === null && commonCount !== null) {
        commonPoints.push({ fileId: paper.fileId, points: part });
        continue;
      }
      if (slot.points && !samePoints(slot.points, part)) {
        slot.reasons.push({ code: "points_conflict", detail: "문제지마다 배점이 다름" });
        slot.points = null;
        continue;
      }
      if (!slot.reasons.some((r) => r.code === "points_conflict")) {
        slot.points = part;
        slot.questionFileId ??= paper.fileId;
      }
    }
  }
  if (commonCount !== null) {
    const common = slots.get("");
    if (common && commonPoints.length) {
      const first = commonPoints[0]!;
      if (commonPoints.every((c) => samePoints(c.points, first.points))) {
        common.points = first.points;
        common.questionFileId = first.fileId;
      } else
        common.reasons.push({ code: "points_conflict", detail: "문제지마다 공통 배점이 다름" });
    }
  }

  for (const slot of slots.values()) {
    if (slot.points && slot.entries.some((e) => !slot.points!.has(e.number))) {
      slot.reasons.push({
        code: "points_range_mismatch",
        detail: "정답표와 문제지 문항 번호가 다름",
      });
      slot.points = null;
    }
    if (!slot.points && !slot.reasons.some((r) => r.code.startsWith("points_")))
      slot.reasons.push({ code: "points_missing", detail: "배점을 확인할 문제지가 없음" });
  }
  return [...slots.values()];
}

function samePoints(a: Map<number, number>, b: Map<number, number>) {
  return a.size === b.size && [...a].every(([n, p]) => b.get(n) === p);
}

export function slotStatus(slot: SlotAnswerKey): "verified" | "manual_review" {
  return slot.answersVerified && slot.points && slot.reasons.length === 0
    ? "verified"
    : "manual_review";
}
