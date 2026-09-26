import { parse } from "node-html-parser";
import { COURSE_CATALOG, courseExpectation } from "../../../lib/courses";
import { normalizeCuts, slotKey, type CollectedGradeCut, type GradeCutAdapter, type WatchExam, type WatchSlot } from "../core";

const PAGE = "https://m.megastudy.net/Entinfo/total_rankCut/main.asp";
// This exact POST is used by the public page's fncSelExamSeq/fncSelExamSubTab scripts.
const FRAGMENT = "https://m.megastudy.net/Entinfo/total_rankCut/main_examRankCut_ax.asp";
const HEADERS = { "User-Agent": "MogoStorageGradeCutWatch/1.0 (+https://mogo-storage.vercel.app)", Accept: "text/html" };
const label = (value: string) => value.replace(/\s|[·・]/g, "");
const examLabel: Record<string, string> = {
  school_mock: "학력평가",
  kice_mock: "모의평가",
  csat: "수능",
};
const identity = (exam: WatchExam) => `고${exam.grade}${exam.examDate.replace(/-/g, ".")}${examLabel[exam.examType] ?? ""}`;

/** Read only IDs actually present in the public high-school senior exam selector. */
export function findMegaExamSeq(page: string, exam: WatchExam): string | null {
  if (exam.grade !== 3 || !examLabel[exam.examType]) return null;
  const root = parse(page);
  if (label(root.querySelector("#examGrdArea li.on")?.text ?? "") !== "고3") return null;
  const expected = `${exam.examDate.replace(/-/g, ".")}${examLabel[exam.examType]}`;
  const matches = root.querySelectorAll("#examNmArea li").filter((li) => label(li.text) === expected);
  if (matches.length !== 1) return null;
  const match = matches[0]!.getAttribute("onclick")?.match(/^fncSelExamSeq\((\d+),'1',\d+\);?$/);
  return match?.[1] ?? null;
}

function relativeCourse(labelText: string, subject: "social" | "science") {
  const name = label(labelText);
  return COURSE_CATALOG.find((course) => course.subject === subject &&
    [course.name, ...course.aliases].some((alias) => label(alias) === name));
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
  if (label(root.querySelector("h4.areaLogo")?.text ?? "") !== identity(exam))
    throw new Error("MegaStudy exam identity mismatch");
  const requested = new Set(slots.filter((slot) => slot.subject === subject && megaStudyAdapter.supports?.(exam, slot)).map(slotKey));
  const result: CollectedGradeCut[] = [];
  const seen = new Set<string>();
  for (const table of root.querySelectorAll("table.tb_basic")) {
    const displayed = table.querySelector("th.sb_th")?.text ?? "";
    const course = relativeCourse(displayed, subject);
    if (!course) {
      console.warn(JSON.stringify({ event: "grade_cut_watch.unknown_course", source: "megastudy", subject, label: displayed.slice(0, 80) }));
      continue;
    }
    if (!requested.has(`${subject}:${course.code}`)) continue;
    if (seen.has(course.code)) throw new Error("duplicate MegaStudy course table");
    seen.add(course.code);
    const headers = table.querySelectorAll("thead tr").at(-1)?.querySelectorAll("th").map((th) => label(th.text));
    if (!headers || headers[0] !== "등급" || headers[1] !== "원점수")
      throw new Error("MegaStudy raw score header missing");
    const cuts = table.querySelectorAll("tbody tr").flatMap((tr) => {
      const cells = tr.querySelectorAll("td");
      const gradeText = label(cells[0]?.text ?? "");
      if (gradeText === "만점") return [];
      if (!/^[1-9]등급$/.test(gradeText) || !/^\d{1,2}$/.test(cells[1]?.text.trim() ?? ""))
        throw new Error("malformed MegaStudy grade row");
      return [{ grade: Number(gradeText[0]), rawScore: Number(cells[1]!.text.trim()) }];
    });
    if (!cuts.length || cuts.some((cut) => cut.rawScore > 50)) throw new Error("invalid inquiry raw score");
    result.push({ subject, courseCode: course.code, cuts: normalizeCuts(cuts), sourceUrl: PAGE, observedAt });
  }
  return result;
}

/** Preserve the existing social parser contract for callers and tests. */
export function parseMegaSocialFragment(fragment: string, exam: WatchExam, slots: readonly WatchSlot[], observedAt: Date) {
  return parseMegaInquiryFragment(fragment, exam, slots, observedAt, "social");
}

async function publicHtml(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { ...HEADERS, ...init?.headers } });
  if (!response.ok) throw new Error(`MegaStudy HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 500_000) throw new Error("MegaStudy response oversized");
  return new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
}

export const megaStudyAdapter: GradeCutAdapter = {
  source: "megastudy",
  status: "automated_verified",
  supports: (exam, slot) => exam.grade === 3 && (slot.subject === "social" || slot.subject === "science") && !!slot.courseCode &&
    courseExpectation(slot.courseCode, exam) === "expected" &&
    !!COURSE_CATALOG.find((course) => course.subject === slot.subject && course.code === slot.courseCode),
  async collect(exam, slots) {
    if (!slots.some((slot) => this.supports?.(exam, slot))) return [];
    const seq = findMegaExamSeq(await publicHtml(PAGE), exam);
    if (!seq) return []; // The exam has not yet appeared on the public selector.
    const collected: CollectedGradeCut[] = [];
    for (const subject of ["social", "science"] as const) {
      if (!slots.some((slot) => slot.subject === subject && this.supports?.(exam, slot))) continue;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const fragment = await publicHtml(FRAGMENT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: new URLSearchParams({ examSeq: seq, tabNo: subject === "social" ? "2" : "3" }),
      });
      collected.push(...parseMegaInquiryFragment(fragment, exam, slots, new Date(), subject));
    }
    return collected;
  },
};
