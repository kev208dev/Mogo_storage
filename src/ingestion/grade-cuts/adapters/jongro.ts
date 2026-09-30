import { parse } from "node-html-parser";
import { COURSE_CATALOG, courseExpectation } from "../../../lib/courses";
import type { GradeCutEntry } from "../../../lib/data/types";
import type { Subject } from "../../../lib/constants";
import { gradingMode } from "../../../lib/grade-cut-mode";
import { decodeHtml, SafeFetcher } from "../../net/fetcher";
import type { Fetcher } from "../../net/fetcher";
import type { GradeCutAdapter, WatchExam, WatchSlot, CollectedGradeCut } from "../core";

const ROOT = "https://www.jongro.co.kr/service/examResult/";
const BOT = "MogoStorageGradeCutWatch/1.0 (+https://mogo-storage.vercel.app)";
const PARSER_VERSION = "jongro-result-cut-v1";
const SUBJECTS: Record<string, Subject> = {
  국어: "korean",
  수학: "math",
  영어: "english",
  한국사: "history",
  탐구: "social",
  사회: "social",
  과학: "science",
};
const normalize = (s: string) => s.replace(/[\s\u200b\u00a0·・]/g, "").trim();
const visibleText = (node: {
  textContent: string;
  querySelectorAll: (
    s: string,
  ) => Array<{ getAttribute: (n: string) => string | undefined; textContent: string }>;
}) =>
  normalize(
    node.textContent +
      node
        .querySelectorAll("img")
        .map((img) => img.getAttribute("alt") ?? "")
        .join(""),
  );

function sourceUrl(exam: WatchExam) {
  return ROOT + "ex" + exam.examDate.replace(/-/g, "") + "/go" + exam.grade + "_resultCut.asp";
}

function parseNumber(value: string): number | null {
  const clean = value.replace(/,/g, "").trim();
  if (!clean || /^[-–—]$/.test(clean)) return null;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(clean)) return null;
  return Number(clean);
}

function entryValue(
  value: string,
): Pick<GradeCutEntry, "rawScore" | "rawScoreMin" | "rawScoreMax" | "rawScoreText"> {
  const clean = value.replace(/,/g, "").trim();
  const range = /^(\d+(?:\.\d+)?)\s*[~～-]\s*(\d+(?:\.\d+)?)$/.exec(clean);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return { rawScoreMin: min, rawScoreMax: max, rawScoreText: clean };
  }
  const number = parseNumber(clean);
  return number === null ? {} : { rawScore: number };
}

function courseFor(label: string, subject: Subject | null, exam: WatchExam) {
  const wanted = normalize(label);
  if (!wanted) return null;
  const item = COURSE_CATALOG.find(
    (course) =>
      (subject === null || course.subject === subject) &&
      [course.name, ...course.aliases, ...course.abbreviations].some(
        (name) => normalize(name) === wanted,
      ),
  );
  if (!item || courseExpectation(item.code, exam) !== "expected") return null;
  return item;
}

function headerLabel(cell: {
  textContent: string;
  querySelectorAll: (s: string) => Array<{ getAttribute: (n: string) => string | undefined }>;
}) {
  const imageText = cell
    .querySelectorAll("img")
    .map((img) => img.getAttribute("alt") ?? "")
    .join(" ");
  return normalize(cell.textContent + " " + imageText);
}

function parseTable(table: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>[number]) {
  const rows = table.querySelectorAll("tr");
  const headerIndex = rows.findIndex((row) => {
    const labels = row.querySelectorAll("th,td").map(headerLabel);
    return labels.some((x) => x.includes("등급")) && labels.some((x) => x.includes("원점수"));
  });
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex]!.querySelectorAll("th,td").map(headerLabel);
  const rawIndex = headers.findIndex((x) => x.includes("원점수"));
  const standardIndex = headers.findIndex((x) => x.includes("표준점수"));
  const percentileIndex = headers.findIndex((x) => x.includes("백분위"));
  const cuts: GradeCutEntry[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const cells = row.querySelectorAll("th,td");
    if (cells.length <= rawIndex) continue;
    const gradeLabel = visibleText(cells[0]!);
    const gradeMatch = /([0-9]+)등급/.exec(gradeLabel);
    if (!gradeMatch) continue;
    const grade = Number(gradeMatch[1]);
    if (grade === 0) continue; // 만점 행
    if (grade < 1 || grade > 9) continue;
    const raw = entryValue(visibleText(cells[rawIndex]!));
    const standardScore =
      standardIndex >= 0 ? parseNumber(visibleText(cells[standardIndex]!)) : null;
    const percentile =
      percentileIndex >= 0 ? parseNumber(visibleText(cells[percentileIndex]!)) : null;
    if (Object.keys(raw).length === 0 && standardScore === null && percentile === null) continue;
    cuts.push({
      grade,
      ...raw,
      ...(standardScore === null ? {} : { standardScore }),
      ...(percentile === null ? {} : { percentile }),
    });
  }
  return cuts.length ? cuts : null;
}

function panelIndex(className: string): number | null {
  const match = /tabCon0?(\d+)/.exec(className);
  return match ? Number(match[1]) : null;
}

function courseLabelFor(
  panel: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>[number],
  table: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>[number],
) {
  const tagged = table.getAttribute("data-course") ?? table.getAttribute("data-subject");
  if (tagged) return tagged;
  const caption = table.querySelector("caption");
  if (caption) return caption.textContent;
  const active = panel.querySelectorAll(
    ".tabController02 .on, .tabController02_01 .on, .tabController02_02 .on",
  );
  if (active.length === 1) return active[0]!.textContent;
  return "";
}

function liveInquiryCourseFor(label: string, exam: WatchExam) {
  const wanted = normalize(label);
  const integratedCode =
    wanted === "사회탐구"
      ? "integrated-social"
      : wanted === "과학탐구"
        ? "integrated-science"
        : null;
  if (integratedCode) {
    const item = COURSE_CATALOG.find((course) => course.code === integratedCode);
    if (item && courseExpectation(item.code, exam) === "expected") return item;
  }
  return courseFor(label, null, exam);
}

function liveCourseLabelFor(
  panel: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>[number],
  table: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>[number],
) {
  const submenu = panel.querySelector(".tab_subject02");
  if (!submenu) return "";
  const labels = submenu
    .querySelectorAll("li")
    .map((node) => visibleText(node))
    .filter(Boolean);
  if (labels.length === 0) return "";
  const subpanel = panel.querySelectorAll("[id]").find((node) => {
    const id = node.getAttribute("id") ?? "";
    return /^tabCon\d+_\d+$/.test(id) && node.querySelectorAll("table").includes(table);
  });
  const match = /_(\d+)$/.exec(subpanel?.getAttribute("id") ?? "");
  if (match) return labels[Number(match[1]) - 1] ?? "";
  return labels.length === 1 ? labels[0]! : "";
}

export interface JongroParsedPage {
  rows: CollectedGradeCut[];
  isOfficial: false;
}

/** Parses the provider's score table fragments. Provider-confirmed rows remain non-official. */
export function parseJongroResultCut(
  html: string,
  exam: WatchExam,
  url = sourceUrl(exam),
  observedAt = new Date(),
): JongroParsedPage {
  const expectedPath =
    "/service/examResult/ex" +
    exam.examDate.replace(/-/g, "") +
    "/go" +
    exam.grade +
    "_resultCut.asp";
  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "www.jongro.co.kr" ||
    parsedUrl.pathname !== expectedPath
  )
    throw new Error("Jongro URL exam identity mismatch");
  const root = parse(html);
  const allText = root.textContent.replace(/\s+/g, " ");
  const dateLabel = String(exam.month) + "." + String(Number(exam.examDate.slice(-2)));
  const yearGradePattern = new RegExp(
    String(exam.year) + "\\s*년?\\s*고" + String(exam.grade) + "(?:\\s|$)",
  );
  if (!yearGradePattern.test(allText) || !allText.includes(dateLabel))
    throw new Error("Jongro page identity mismatch");

  const gradeCutTitle = allText.includes("추정 등급컷")
    ? "provider_estimate"
    : allText.includes("확정 등급컷")
      ? "provider_final"
      : null;
  if (!gradeCutTitle) return { rows: [], isOfficial: false };

  const rows: CollectedGradeCut[] = [];
  const scoreBasis: "raw" | "standard" = allText.includes("표준점수를 토대로 원점수를 역산")
    ? "standard"
    : "raw";

  const collectTable = (
    table: ReturnType<ReturnType<typeof parse>["querySelectorAll"]>[number],
    tabLabel: string,
    tabSubject: Subject,
    courseLabel: string,
    liveLayout: boolean,
  ) => {
    const cuts = parseTable(table);
    if (!cuts) return;
    const course =
      tabLabel === "탐구"
        ? liveLayout
          ? liveInquiryCourseFor(courseLabel, exam)
          : courseFor(courseLabel, null, exam)
        : courseFor(courseLabel, tabSubject, exam);
    const subject = course?.subject ?? tabSubject;
    if (subject !== "korean" && subject !== "math" && subject !== "social" && subject !== "science")
      return;
    if (gradingMode(exam, subject) !== "relative") return;
    let courseCode: string | null = null;
    if (
      subject === "social" ||
      subject === "science" ||
      (exam.grade === 3 && (subject === "korean" || subject === "math"))
    ) {
      if (!course) return;
      courseCode = course.code;
    }
    rows.push({
      subject,
      courseCode,
      cuts,
      sourceUrl: url,
      observedAt,
      providerStatus: gradeCutTitle,
      providerLabel: gradeCutTitle === "provider_final" ? "종로 최종" : "종로 예상",
      observedVia: null,
      firstParty: true,
      scoreBasis,
      parserVersion: PARSER_VERSION,
    });
  };

  // Live Jongro pages use image-alt labels, #tabController01, and id-based tabCon panels.
  const liveNavRoot = root.querySelector("#tabController01");
  const liveNavLabels = liveNavRoot
    ? liveNavRoot.querySelectorAll("li").map((node) => visibleText(node))
    : [];
  const livePanels = root
    .querySelectorAll("[id]")
    .filter((node) => /^tabCon\d+$/.test(node.getAttribute("id") ?? ""));
  if (liveNavLabels.length > 0 && livePanels.length > 0) {
    for (const [position, panel] of livePanels.entries()) {
      const tabLabel = liveNavLabels[position];
      const tabSubject = tabLabel ? SUBJECTS[tabLabel] : undefined;
      if (!tabSubject || tabSubject === "english" || tabSubject === "history") continue;
      for (const table of panel.querySelectorAll("table")) {
        collectTable(table, tabLabel!, tabSubject, liveCourseLabelFor(panel, table), true);
      }
    }
    if (rows.length > 0) return { rows, isOfficial: false };
  }

  // Legacy/minimal fixtures retain the class-based structure used by parser regression tests.
  const nav = root.querySelectorAll(".tabController01 li");
  const navLabels = nav.map((node) => normalize(node.textContent));
  const panels = root.querySelectorAll("[class*=tabCon]");
  for (const panel of panels) {
    const index = panelIndex(panel.getAttribute("class") ?? "");
    if (index === null) continue;
    const tabLabel = navLabels[index - 1];
    const tabSubject = tabLabel ? SUBJECTS[tabLabel] : undefined;
    if (!tabLabel || !tabSubject || tabSubject === "english" || tabSubject === "history") continue;
    for (const table of panel.querySelectorAll("table")) {
      collectTable(table, tabLabel, tabSubject, courseLabelFor(panel, table), false);
    }
  }
  return { rows, isOfficial: false };
}

const safeFetcher = new SafeFetcher({
  policy: { allowedHosts: ["www.jongro.co.kr"], allowHttp: false },
  timeoutMs: 15_000,
  maxConcurrent: 1,
  minGapMs: 2_000,
  maxRetries: 2,
  userAgent: BOT,
  respectRobots: true,
});

export function createJongroAdapter(fetcher: Fetcher = safeFetcher): GradeCutAdapter {
  return {
    source: "jongro",
    status: "automated_verified",
    supports: (exam, slot) => {
      if (!slot || gradingMode(exam, slot.subject) !== "relative") return false;
      if (slot.subject === "english" || slot.subject === "history") return false;
      if (slot.subject === "social" || slot.subject === "science") {
        if (!slot.courseCode) return false;
        return courseFor(slot.courseCode, slot.subject, exam) !== null;
      }
      if ((slot.subject === "korean" || slot.subject === "math") && exam.grade === 3)
        return !!slot.courseCode && courseFor(slot.courseCode, slot.subject, exam) !== null;
      return slot.subject === "korean" || slot.subject === "math";
    },
    async collect(exam, slots) {
      const url = sourceUrl(exam);
      const response = await fetcher.fetch(url, { accept: "text/html", maxBytes: 1_000_000 });
      const html = /charset=(?:euc-kr|cp949|ks_c_5601-1987)/i.test(response.contentType)
        ? new TextDecoder("euc-kr", { fatal: true }).decode(response.bytes)
        : decodeHtml(response);
      const parsed = parseJongroResultCut(html, exam, url);
      const requested = new Set(slots.map((slot) => slot.subject + ":" + (slot.courseCode ?? "")));
      return parsed.rows.filter((row) => requested.has(row.subject + ":" + (row.courseCode ?? "")));
    },
  };
}

export const jongroAdapter = createJongroAdapter();
