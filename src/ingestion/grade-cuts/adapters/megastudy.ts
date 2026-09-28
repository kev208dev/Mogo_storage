import { parse } from "node-html-parser";
import { SafeFetcher, decodeHtml } from "../../net/fetcher";
import type { Fetcher } from "../../net/fetcher";
import { COURSE_CATALOG, courseExpectation } from "../../../lib/courses";
import type { Subject } from "../../../lib/constants";
import {
  normalizeCuts,
  slotKey,
  type CollectedGradeCut,
  type GradeCutAdapter,
  type WatchExam,
  type WatchSlot,
} from "../core";
import { maxRawScore } from "../validate";

const PAGE = "https://m.megastudy.net/Entinfo/total_rankCut/main.asp";
// This exact POST is used by the public page's fncSelExamSeq/fncSelExamSubTab scripts.
const FRAGMENT = "https://m.megastudy.net/Entinfo/total_rankCut/main_examRankCut_ax.asp";
// fncSelExamGrd → fncSelExamYear 가 쓰는 고1·고2 시험 목록 (같은 공개 페이지의 스크립트)
const EXAM_LIST = "https://m.megastudy.net/Entinfo/total_rankCut/main_examNm_ax.asp";
/** 탭 번호: 1 = 국어·수학·영어·한국사, 2 = 사회탐구, 3 = 과학탐구 */
const TAB: Record<"core" | "social" | "science", string> = { core: "1", social: "2", science: "3" };
const HEADERS = {
  "User-Agent": "MogoStorageGradeCutWatch/1.0 (+https://mogo-storage.vercel.app)",
  Accept: "text/html",
};
const label = (value: string) => value.replace(/\s|[·・]/g, "");
const examLabel: Record<string, string> = {
  school_mock: "학력평가",
  kice_mock: "모의평가",
  csat: "수능",
};
const identity = (exam: WatchExam) =>
  `고${exam.grade}${exam.examDate.replace(/-/g, ".")}${examLabel[exam.examType] ?? ""}`;

function uniqueSeq(
  items: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>,
  exam: WatchExam,
) {
  const expected = `${exam.examDate.replace(/-/g, ".")}${examLabel[exam.examType]}`;
  const matches = items.filter((li) => label(li.text) === expected);
  if (matches.length !== 1) return null;
  const match = matches[0]!.getAttribute("onclick")?.match(/^fncSelExamSeq\((\d+),'1',\d+\);?$/);
  return match?.[1] ?? null;
}

/** Read only IDs actually present in the public high-school senior exam selector. */
export function findMegaExamSeq(page: string, exam: WatchExam): string | null {
  if (exam.grade !== 3 || !examLabel[exam.examType]) return null;
  const root = parse(page);
  if (label(root.querySelector("#examGrdArea li.on")?.text ?? "") !== "고3") return null;
  return uniqueSeq(root.querySelectorAll("#examNmArea li"), exam);
}

/** 고1·고2: 공개 페이지가 학년 선택 시 받아오는 시험 목록 fragment 에서 같은 날짜·종류가 하나일 때만 */
export function findMegaExamSeqInList(list: string, exam: WatchExam): string | null {
  if (exam.grade === 3 || exam.examType !== "school_mock") return null;
  return uniqueSeq(parse(list).querySelectorAll("li"), exam);
}

function relativeCourse(labelText: string, subject: "social" | "science") {
  const name = label(labelText);
  return COURSE_CATALOG.find(
    (course) =>
      course.subject === subject &&
      [course.name, ...course.aliases].some((alias) => label(alias) === name),
  );
}

type TableRow = { grade: number; rawScore: number };

/**
 * 원점수 열이 명시된 표만 읽는다. 표준점수·백분위에서 원점수를 추정하지 않는다.
 * "만점" 행이 있으면 영역 만점과 같아야 한다 (다른 시험·과목 표가 섞였는지 확인).
 * 소수 원점수는 반올림하지 않고 그대로 보존한다.
 */
function rawScoreTable(
  table: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>[number],
  subject: Subject,
): TableRow[] | null {
  const headers = table
    .querySelectorAll("thead tr")
    .at(-1)
    ?.querySelectorAll("th")
    .map((th) => label(th.text));
  if (!headers || headers[0] !== "등급" || headers[1] !== "원점수")
    throw new Error("MegaStudy raw score header missing");
  const cuts = table.querySelectorAll("tbody tr").flatMap((tr) => {
    const cells = tr.querySelectorAll("td");
    const gradeText = label(cells[0]?.text ?? "");
    const scoreText = cells[1]?.text.trim() ?? "";
    if (gradeText === "만점") {
      if (Number(scoreText) !== maxRawScore(subject))
        throw new Error("MegaStudy max score mismatch");
      return [];
    }
    if (!/^[1-9]등급$/.test(gradeText)) throw new Error("malformed MegaStudy grade row");
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(scoreText))
      throw new Error("malformed MegaStudy grade row");
    return [{ grade: Number(gradeText[0]), rawScore: Number(scoreText) }];
  });
  if (!cuts.length || cuts.some((cut) => cut.rawScore > maxRawScore(subject)))
    throw new Error("invalid MegaStudy raw score");
  return cuts;
}

function checkIdentity(root: ReturnType<typeof parse>, exam: WatchExam) {
  if (label(root.querySelector("h4.areaLogo")?.text ?? "") !== identity(exam))
    throw new Error("MegaStudy exam identity mismatch");
}

function warnSkipped(subject: Subject, reason: string, displayed: string) {
  console.warn(
    JSON.stringify({
      event: "grade_cut_watch.skipped_table",
      source: "megastudy",
      subject,
      reason,
      label: displayed.slice(0, 80),
    }),
  );
}

/** Both inquiry tabs have an explicit 원점수 column. Never infer raw scores from standard scores. */
export function parseMegaInquiryFragment(
  fragment: string,
  exam: WatchExam,
  slots: readonly WatchSlot[],
  observedAt: Date,
  subject: "social" | "science",
): CollectedGradeCut[] {
  const root = parse(fragment);
  checkIdentity(root, exam);
  const requested = new Set(
    slots
      .filter((slot) => slot.subject === subject && megaStudyAdapter.supports?.(exam, slot))
      .map(slotKey),
  );
  const result: CollectedGradeCut[] = [];
  const seen = new Set<string>();
  for (const table of root.querySelectorAll("table.tb_basic")) {
    const displayed = table.querySelector("th.sb_th")?.text ?? "";
    const course = relativeCourse(displayed, subject);
    if (!course) {
      warnSkipped(subject, "unknown_course", displayed);
      continue;
    }
    if (!requested.has(`${subject}:${course.code}`)) continue;
    if (seen.has(course.code)) throw new Error("duplicate MegaStudy course table");
    seen.add(course.code);
    const cuts = rawScoreTable(table, subject);
    if (!cuts) {
      warnSkipped(subject, "half_point", displayed);
      continue;
    }
    result.push({
      subject,
      courseCode: course.code,
      cuts: normalizeCuts(cuts),
      sourceUrl: PAGE,
      observedAt,
    });
  }
  return result;
}

const CORE_LABEL: Partial<Record<Subject, string>> = { korean: "국어", math: "수학" };

/**
 * 고1·고2 국어·수학 (영역 전체 한 표). 고3 표는 표준점수·백분위만 있어 원점수 헤더 검사에서 거부된다.
 * 영어·한국사(절대평가)는 읽지 않는다.
 */
export function parseMegaCoreFragment(
  fragment: string,
  exam: WatchExam,
  slots: readonly WatchSlot[],
  observedAt: Date,
): CollectedGradeCut[] {
  const root = parse(fragment);
  checkIdentity(root, exam);
  const wanted = slots.filter(
    (slot) => CORE_LABEL[slot.subject] && megaStudyAdapter.supports?.(exam, slot),
  );
  const result: CollectedGradeCut[] = [];
  for (const slot of wanted) {
    const tables = root
      .querySelectorAll("table.tb_basic")
      .filter((t) => label(t.querySelector("th.sb_th")?.text ?? "") === CORE_LABEL[slot.subject]);
    if (tables.length === 0) continue;
    if (tables.length > 1) throw new Error("duplicate MegaStudy subject table");
    const cuts = rawScoreTable(tables[0]!, slot.subject);
    if (!cuts) {
      warnSkipped(slot.subject, "half_point", CORE_LABEL[slot.subject]!);
      continue;
    }
    result.push({
      subject: slot.subject,
      courseCode: null,
      cuts: normalizeCuts(cuts),
      sourceUrl: PAGE,
      observedAt,
    });
  }
  return result;
}

/** Preserve the existing social parser contract for callers and tests. */
export function parseMegaSocialFragment(
  fragment: string,
  exam: WatchExam,
  slots: readonly WatchSlot[],
  observedAt: Date,
) {
  return parseMegaInquiryFragment(fragment, exam, slots, observedAt, "social");
}

const megaFetcher = new SafeFetcher({
  policy: { allowedHosts: [".megastudy.net"], allowHttp: false },
  timeoutMs: 12_000,
  maxConcurrent: 1,
  minGapMs: 500,
  maxRetries: 2,
  userAgent: HEADERS["User-Agent"],
  respectRobots: true,
});

async function publicHtml(fetcher: Fetcher, url: string, init?: RequestInit) {
  const response = await fetcher.fetch(url, {
    method: init?.method,
    body: init?.body,
    accept: "text/html",
    maxBytes: 500_000,
    headers: { ...HEADERS, ...init?.headers },
  });
  return decodeHtml(response);
}

/**
 * 시험 선택 페이지는 한 번의 watch 실행에서 여러 시험이 같은 페이지를 읽는다 → 짧게 캐시해 요청을 한 번으로 줄인다.
 * 점수 fragment 는 캐시하지 않는다 (값이 바뀌는 대상).
 */
const SELECTOR_TTL_MS = 60_000;
let selectorCache: { at: number; html: string } | null = null;
async function selectorPage(fetcher: Fetcher, now = Date.now()): Promise<string> {
  if (selectorCache && now - selectorCache.at < SELECTOR_TTL_MS) return selectorCache.html;
  const html = await publicHtml(fetcher, PAGE);
  selectorCache = { at: now, html };
  return html;
}
export function resetMegaStudyCache() {
  selectorCache = null;
}

const inquiryCourse = (exam: WatchExam, slot: WatchSlot) =>
  !!slot.courseCode &&
  courseExpectation(slot.courseCode, exam) === "expected" &&
  !!COURSE_CATALOG.find(
    (course) => course.subject === slot.subject && course.code === slot.courseCode,
  );

export function createMegaStudyAdapter(fetcher: Fetcher = megaFetcher): GradeCutAdapter {
  return {
    source: "megastudy",
    status: "automated_verified",
    /**
     * 공개 표에 원점수 열이 확인된 조합만:
     *  - 고3 사회·과학탐구 세부과목
     *  - 고2 학력평가 사회·과학탐구 세부과목
     *  - 고1·고2 학력평가 국어·수학 (영역 전체)
     * 고3 국어·수학은 표준점수만, 고1 통합사회·통합과학은 반점수라 제외한다.
     */
    supports: (exam, slot) => {
      if (slot.subject === "social" || slot.subject === "science")
        return (
          (exam.grade === 3 || (exam.grade === 2 && exam.examType === "school_mock")) &&
          inquiryCourse(exam, slot)
        );
      if (slot.subject === "korean" || slot.subject === "math")
        return exam.grade !== 3 && exam.examType === "school_mock" && slot.courseCode === null;
      return false;
    },
    async collect(exam, slots) {
      const wanted = slots.filter((slot) => this.supports?.(exam, slot));
      if (!wanted.length) return [];
      const seq =
        exam.grade === 3
          ? findMegaExamSeq(await selectorPage(fetcher), exam)
          : findMegaExamSeqInList(
              await publicHtml(fetcher, EXAM_LIST, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
                body: new URLSearchParams({
                  grdFlg: String(exam.grade),
                  examYear: "",
                  examType: "",
                }),
              }),
              exam,
            );
      if (!seq) return []; // The exam has not yet appeared on the public selector.
      const collected: CollectedGradeCut[] = [];
      for (const tab of ["core", "social", "science"] as const) {
        const needed = wanted.filter((slot) =>
          tab === "core"
            ? slot.subject === "korean" || slot.subject === "math"
            : slot.subject === tab,
        );
        if (!needed.length) continue;
        await new Promise((resolve) => setTimeout(resolve, 500));
        const fragment = await publicHtml(fetcher, FRAGMENT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: new URLSearchParams({ examSeq: seq, tabNo: TAB[tab] }),
        });
        const observedAt = new Date();
        collected.push(
          ...(tab === "core"
            ? parseMegaCoreFragment(fragment, exam, slots, observedAt)
            : parseMegaInquiryFragment(fragment, exam, slots, observedAt, tab)),
        );
      }
      return collected;
    },
  };
}

export const megaStudyAdapter = createMegaStudyAdapter();
