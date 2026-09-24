import type { Subject } from "../../../lib/constants";
import { classifyArtifact } from "../../canonical/classify";
import type { CourseResolution } from "../../canonical/course";
import { canonicalizeExamTitle } from "../../canonical/exam-title";
import { normalizeSubject } from "../../canonical/subject";
import { SourceStructureChangedError } from "../../errors";
import type { CanonicalExam, DiscoveredArtifact } from "../../types";
import {
  absoluteUrl,
  compact,
  extractLinkTarget,
  parseHtml,
  tableGrid,
  text,
  type HTMLElement,
} from "../html";

/**
 * KICE 시험별 자료 index 페이지 parser (게시판이 아니라 시험마다 따로 있는 안내/자료 표).
 *
 * 공개적으로 알려진 형식: 시험명 + 표(교시 · 시험영역 · 정답 공개시간 · 문제 · 정답 · 듣기평가 · 음성대본).
 * ⚠️ 검증 상태: 실제 페이지 HTML 을 이 환경에서 확보하지 못했다. 그래서 CSS class 같은 사이트 고유 selector 를
 *    가정하지 않고, 표의 "머리글 텍스트"로 열 역할을 찾는다. 머리글을 찾지 못하면 SourceStructureChangedError.
 *    공개 시각은 표에 적힌 값만 쓰며 어떤 시험에도 고정 시각을 가정하지 않는다.
 */

export type IndexColumnRole =
  | "period"
  | "area"
  | "releaseTime"
  | "question"
  | "solution"
  | "listening_audio"
  | "listening_script";

/** 머리글 텍스트 → 열 역할 (공백 제거 후 비교, 위에서부터 먼저 맞는 것) */
const HEADER_RULES: Array<[RegExp, IndexColumnRole]> = [
  [/공개(시간|시각|예정)/, "releaseTime"],
  [/교시/, "period"],
  [/(시험)?영역|과목/, "area"],
  [/대본|스크립트/, "listening_script"],
  [/듣기/, "listening_audio"],
  [/정답|해설/, "solution"],
  [/문제/, "question"],
];

export interface ReleaseTimeEntry {
  subject: Subject;
  course: CourseResolution;
  /** 표의 영역 표기 원문 */
  sourceLabel: string;
  period: string | null;
  /** 표에 적힌 원문 (예: "10:56", "9. 4.(목) 17:04") */
  rawTime: string;
  /** 해석한 공식 공개 시각 (KST, ISO). 날짜를 알 수 없으면 null */
  officialReleaseAt: string | null;
}

export interface ParsedExamIndex {
  title: string | null;
  exam: CanonicalExam | null;
  artifacts: DiscoveredArtifact[];
  releaseTimes: ReleaseTimeEntry[];
  /** 열 역할 → 머리글 원문 (디버깅/fixture summary 용) */
  columns: Partial<Record<IndexColumnRole, string>>;
  warnings: Array<{ code: string; message: string }>;
}

function headerRole(label: string): IndexColumnRole | null {
  const c = compact(label);
  for (const [pattern, role] of HEADER_RULES) if (pattern.test(c)) return role;
  return null;
}

/** 표에서 머리글 행을 찾는다: "영역" 열과 자료 열(문제/정답)이 모두 있는 첫 행 */
function findHeader(grid: HTMLElement[][]) {
  for (let r = 0; r < Math.min(grid.length, 4); r += 1) {
    const roles = new Map<number, { role: IndexColumnRole; label: string }>();
    grid[r]!.forEach((cell, c) => {
      const label = text(cell);
      const role = headerRole(label);
      if (role && ![...roles.values()].some((v) => v.role === role)) roles.set(c, { role, label });
    });
    const has = (role: IndexColumnRole) => [...roles.values()].some((v) => v.role === role);
    if (has("area") && (has("question") || has("solution"))) return { row: r, roles };
  }
  return null;
}

const TIME = /(?<![\d:])([01]?\d|2[0-3])\s*[:시]\s*([0-5]\d)(?!\d)/;
const DATE = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/;
const MONTH_DAY = /(?<!\d)(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(?:\(|[가-힣]요일|\s|$)/;

/**
 * 공개 시각 표기 → ISO(KST). 날짜가 없으면 examDate(시험일)를 쓴다. 둘 다 없으면 null.
 * "다음 날" 같은 표기는 해석하지 않는다(null) — 추정하지 않는다.
 */
export function parseReleaseTime(raw: string, examDate: string | null): string | null {
  const t = TIME.exec(raw);
  if (!t) return null;
  const hh = t[1]!.padStart(2, "0");
  const mm = t[2]!;
  let date: string | null = null;
  const full = DATE.exec(raw);
  if (full) {
    date = `${full[1]}-${full[2]!.padStart(2, "0")}-${full[3]!.padStart(2, "0")}`;
  } else {
    const md = MONTH_DAY.exec(raw.slice(0, t.index));
    if (md && examDate) {
      date = `${examDate.slice(0, 4)}-${md[1]!.padStart(2, "0")}-${md[2]!.padStart(2, "0")}`;
    } else if (!/다음\s*날|익일|내일/.test(raw)) {
      date = examDate;
    }
  }
  if (!date) return null;
  const d = new Date(`${date}T${hh}:${mm}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function linksIn(cell: HTMLElement | undefined): HTMLElement[] {
  if (!cell) return [];
  const links = cell.querySelectorAll("a, button");
  return links.filter((l) => extractLinkTarget(l));
}

/** 시험명: context 로 받은 값 우선, 없으면 페이지 제목/머리말에서 */
function findTitle(root: HTMLElement): string | null {
  const candidates = [
    ...root.querySelectorAll("h1, h2, h3, caption, title").map((el) => text(el)),
  ].filter((t) => /(학년도|모의평가|수학능력시험|수능)/.test(t));
  return candidates[0] ?? null;
}

export function parseKiceExamIndex(
  html: string,
  context: { pageUrl: string; examTitle?: string | null; examDate?: string | null },
): ParsedExamIndex {
  const root = parseHtml(html);
  const warnings: ParsedExamIndex["warnings"] = [];
  const title = context.examTitle ?? findTitle(root);
  const canonical = title ? canonicalizeExamTitle(title) : null;
  if (title && canonical && !canonical.ok) {
    warnings.push({ code: "UNRECOGNIZED_TITLE", message: `${title}: ${canonical.reason}` });
  }
  if (!title) warnings.push({ code: "NO_TITLE", message: "exam title not found on page" });

  let header: ReturnType<typeof findHeader> = null;
  let grid: HTMLElement[][] = [];
  for (const table of root.querySelectorAll("table")) {
    grid = tableGrid(table);
    header = findHeader(grid);
    if (header) break;
  }
  if (!header) {
    throw new SourceStructureChangedError(
      "kice",
      "exam index table not found (need header cells for 영역 and 문제/정답)",
    );
  }
  const columns: ParsedExamIndex["columns"] = {};
  const colOf = new Map<IndexColumnRole, number>();
  for (const [c, { role, label }] of header.roles) {
    columns[role] = label;
    colOf.set(role, c);
  }

  const artifacts: DiscoveredArtifact[] = [];
  const releaseTimes: ReleaseTimeEntry[] = [];
  const seenRows = new Set<string>();
  for (let r = header.row + 1; r < grid.length; r += 1) {
    const row = grid[r]!;
    const areaCell = row[colOf.get("area")!];
    const area = text(areaCell);
    if (!area || headerRole(area) === "area") continue; // 두 줄 머리글 등
    const subjectHint = normalizeSubject(area);
    if (!subjectHint) {
      warnings.push({ code: "UNSUPPORTED_SUBJECT", message: area });
      continue;
    }
    const period = colOf.has("period") ? text(row[colOf.get("period")!]) || null : null;

    // 자료 열: 링크가 있으면 artifact (없거나 "-" 면 아직 공개 전)
    let rowCourse: CourseResolution = { status: "none" };
    for (const role of ["question", "solution", "listening_audio", "listening_script"] as const) {
      const c = colOf.get(role);
      if (c === undefined) continue;
      for (const link of linksIn(row[c])) {
        const url = absoluteUrl(extractLinkTarget(link)!, context.pageUrl);
        if (!url) continue;
        const key = `${area}|${role}|${url}`;
        if (seenRows.has(key)) continue; // rowspan 으로 같은 셀이 반복될 때
        seenRows.add(key);
        const result = classifyArtifact({ subjectLabel: area, linkLabel: columns[role]!, url });
        if (!result.ok) {
          warnings.push({ code: result.reason.toUpperCase(), message: `${area} ${columns[role]}` });
          continue;
        }
        // 열 역할이 자료 종류의 근거다 (링크 텍스트가 "다운로드" 뿐이어도)
        const artifact: DiscoveredArtifact = {
          ...result.artifact,
          type: role,
          label: text(link) || columns[role]!,
          courseLabel: result.artifact.course.status === "none" ? null : area,
          sourceLabel: `${area} ${columns[role]}`,
        };
        rowCourse = artifact.course;
        artifacts.push(artifact);
      }
    }

    const tc = colOf.get("releaseTime");
    const rawTime = tc !== undefined ? text(row[tc]) : "";
    if (rawTime) {
      const areaInfo = classifyArtifact({
        subjectLabel: area,
        linkLabel: "문제",
        url: context.pageUrl,
      });
      const course: CourseResolution =
        rowCourse.status !== "none"
          ? rowCourse
          : areaInfo.ok
            ? areaInfo.artifact.course
            : { status: "none" };
      const officialReleaseAt = parseReleaseTime(rawTime, context.examDate ?? null);
      if (!officialReleaseAt && TIME.test(rawTime)) {
        warnings.push({ code: "RELEASE_DATE_UNKNOWN", message: `${area}: ${rawTime}` });
      }
      const key = `${area}|time`;
      if (!seenRows.has(key)) {
        seenRows.add(key);
        releaseTimes.push({
          subject: subjectHint,
          course,
          sourceLabel: area,
          period,
          rawTime,
          officialReleaseAt,
        });
      }
    }
  }
  for (const a of artifacts) {
    const t = releaseTimes.find((rt) => rt.sourceLabel && a.sourceLabel.startsWith(rt.sourceLabel));
    if (t?.officialReleaseAt) a.officialReleaseAt = t.officialReleaseAt;
  }
  if (artifacts.length === 0 && releaseTimes.length === 0) {
    throw new SourceStructureChangedError(
      "kice",
      "exam index table has a header but no subject rows",
    );
  }
  return {
    title,
    exam: canonical?.ok ? canonical.exam : null,
    artifacts,
    releaseTimes,
    columns,
    warnings,
  };
}
