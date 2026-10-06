import type { Grade } from "../../../lib/constants";
import { classifyArtifact } from "../../canonical/classify";
import { canonicalizeExamTitle, canonicalKey } from "../../canonical/exam-title";
import { SourceStructureChangedError } from "../../errors";
import type { CanonicalExam, DiscoveredArtifact, DiscoveredExam } from "../../types";
import { absoluteUrl, extractLinkTarget, parseHtml, text, type HTMLElement } from "../html";
import { ebsiListingUrl, EBSI_STRUCTURE as LIVE } from "./structure";

export interface ParsedEbsiExam extends DiscoveredExam {
  artifacts: DiscoveredArtifact[];
}

export interface ParseWarning {
  code: string;
  message: string;
}

/** 이전 synthetic fixture 계약은 unit test/fixture drift 검사용으로 유지한다. */
const LEGACY = {
  listContainer: "ul.board_list",
  emptyMarker: ".no_data",
  examItem: "li.exam",
  examTitle: ".tit",
  examDate: ".date",
  examIdAttribute: "data-exam-id",
  subjectBlock: ".board_qusesion .subj",
  subjectName: ".subject",
  downloadLink: "a, button",
} as const;

const WDOWN_PREFIX = "https://wdown.ebsi.co.kr/W61001/01exam";

type LiveDownloadKind = "P" | "H" | "R" | "D";

export interface ParsedLiveEbsiPage {
  exams: DiscoveredExam[];
  artifactsByExternalId: Map<string, DiscoveredArtifact[]>;
  total: number;
  itemCount: number;
  warnings: ParseWarning[];
}

function downloadCall(onclick: string): { kind: LiveDownloadKind; path: string; externalId: string } | null {
  const m = /^\s*goDownLoad([PHRD])\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(onclick.trim());
  if (!m) return null;
  const args = [...m[2]!.matchAll(/'((?:\\'|[^'])*)'/g)].map((x) =>
    x[1]!.replace(/\\'/g, "'"),
  );
  const path = args[0]?.trim();
  const externalId = args[2]?.trim();
  if (!path || !externalId) return null;
  return { kind: m[1]!.toUpperCase() as LiveDownloadKind, path, externalId };
}

function liveFileUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${WDOWN_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
}

function liveTypeLabel(kind: LiveDownloadKind): string {
  switch (kind) {
    case "P":
      return "문제";
    case "H":
      return "해설";
    case "R":
      return "듣기";
    case "D":
      return "대본";
  }
}

function dateFromDownloadPath(path: string): string | null {
  const m = /\/(20\d{2})(\d{2})(\d{2})\//.exec(path);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function liveItems(html: string): HTMLElement[] {
  const root = parseHtml(html);
  const items = root.querySelectorAll(LIVE.item);
  if (items.length > 0) return items;
  const totalText = text(root.querySelector(LIVE.total));
  if (/^0\s*개?$/.test(totalText) || /검색.*0개|0개.*검색/.test(text(root))) return [];
  throw new SourceStructureChangedError("ebsi", `live item selector "${LIVE.item}" not found`);
}

/**
 * 현재 EBSi previousPaperListAjax.ajax fragment parser.
 * qus_box 1개는 세부과목 1개이며 같은 시험의 여러 qus_box는 irecord로 묶는다.
 */
export function parseEbsiLivePage(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): ParsedLiveEbsiPage {
  const root = parseHtml(html);
  const totalRaw = text(root.querySelector(LIVE.total)).replace(/,/g, "");
  const total = Number.parseInt(totalRaw, 10);
  const warnings: ParseWarning[] = [];
  const examsById = new Map<string, DiscoveredExam>();
  const artifactsByExternalId = new Map<string, DiscoveredArtifact[]>();
  const items = liveItems(html);

  for (const item of items) {
    const flags = item.querySelectorAll(LIVE.flags).map((el) => text(el)).filter(Boolean);
    const subjectLabel = flags.at(-1) ?? null;
    const title = text(item.querySelector(LIVE.title)).replace(/\s+/g, " ").trim();
    if (!title) throw new SourceStructureChangedError("ebsi", `live title "${LIVE.title}" missing`);

    const calls = item
      .querySelectorAll(LIVE.downloadButton)
      .map((button) => ({
        button,
        call: downloadCall(button.getAttribute("onclick") ?? ""),
      }))
      .filter((x): x is { button: HTMLElement; call: NonNullable<ReturnType<typeof downloadCall>> } =>
        Boolean(x.call),
      );
    if (calls.length === 0) {
      warnings.push({ code: "NO_DOWNLOADS", message: title });
      continue;
    }

    const externalId = calls[0]!.call.externalId;
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) {
      warnings.push({ code: "UNRECOGNIZED_TITLE", message: `${title}: ${canonical.reason}` });
      continue;
    }
    const examDate =
      calls.map((x) => dateFromDownloadPath(x.call.path)).find((x): x is string => Boolean(x)) ??
      null;

    if (!examsById.has(externalId)) {
      examsById.set(externalId, {
        externalId,
        sourceUrl: context.pageUrl,
        title,
        canonical: canonical.exam,
        examDate,
        metadata: {
          listingGrade: context.grade,
          listingYear: context.year,
          artifactPageUrl: context.pageUrl,
          ebsiIrecord: externalId,
        },
      });
    } else {
      const existing = examsById.get(externalId)!;
      if (canonicalKey(existing.canonical) !== canonicalKey(canonical.exam)) {
        throw new SourceStructureChangedError(
          "ebsi",
          `irecord ${externalId} maps to multiple exam identities`,
        );
      }
    }

    const bucket = artifactsByExternalId.get(externalId) ?? [];
    for (const { call } of calls) {
      const url = liveFileUrl(call.path);
      const label = `${title} ${liveTypeLabel(call.kind)}`;
      const classified = classifyArtifact({ subjectLabel, linkLabel: label, url });
      if (!classified.ok) {
        warnings.push({ code: classified.reason.toUpperCase(), message: label });
        continue;
      }
      bucket.push({
        ...classified.artifact,
        sourceLabel: `${title} ${liveTypeLabel(call.kind)}`,
      });
    }
    artifactsByExternalId.set(externalId, bucket);
  }

  const exams = [...examsById.values()];
  return {
    exams,
    artifactsByExternalId,
    total: Number.isFinite(total) ? total : items.length,
    itemCount: items.length,
    warnings,
  };
}

/** legacy synthetic fixture helpers */
function legacyArtifactsFromItem(
  item: HTMLElement,
  pageUrl: string,
  warnings: ParseWarning[],
): { artifacts: DiscoveredArtifact[]; blocks: number } {
  const artifacts: DiscoveredArtifact[] = [];
  const blocks = item.querySelectorAll(LEGACY.subjectBlock);
  for (const block of blocks) {
    const subjectLabel = text(block.querySelector(LEGACY.subjectName));
    for (const link of block.querySelectorAll(LEGACY.downloadLink)) {
      const label = text(link);
      const target = extractLinkTarget(link);
      const url = target ? absoluteUrl(target, pageUrl) : null;
      if (!url) continue;
      const result = classifyArtifact({ subjectLabel, linkLabel: label, url });
      if (!result.ok) {
        if (result.reason === "unsupported_subject")
          warnings.push({ code: "UNSUPPORTED_SUBJECT", message: subjectLabel || label });
        continue;
      }
      artifacts.push(result.artifact);
    }
  }
  return { artifacts, blocks: blocks.length };
}

function dedupeWarnings(warnings: ParseWarning[]) {
  const seen = new Set<string>();
  for (let i = warnings.length - 1; i >= 0; i -= 1) {
    const key = `${warnings[i]!.code}:${warnings[i]!.message}`;
    if (seen.has(key)) warnings.splice(i, 1);
    seen.add(key);
  }
}

function legacyItems(html: string) {
  const root = parseHtml(html);
  const container = root.querySelector(LEGACY.listContainer);
  if (!container) {
    if (root.querySelector(LEGACY.emptyMarker)) return [];
    throw new SourceStructureChangedError("ebsi", `list container "${LEGACY.listContainer}" not found`);
  }
  const items = container.querySelectorAll(LEGACY.examItem);
  if (items.length === 0) {
    if (container.querySelector(LEGACY.emptyMarker) || root.querySelector(LEGACY.emptyMarker))
      return [];
    throw new SourceStructureChangedError("ebsi", `no "${LEGACY.examItem}" items and no empty marker`);
  }
  return items;
}

function legacyExternalId(item: HTMLElement, exam: CanonicalExam): string {
  return item.getAttribute(LEGACY.examIdAttribute)?.trim() || `${canonicalKey(exam)}-${exam.examType}`;
}

/**
 * Synthetic fixture API. Live adapter uses parseEbsiLivePage.
 */
export function parseEbsiExamList(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: DiscoveredExam[]; warnings: ParseWarning[] } {
  if (html.includes("qus_box")) {
    const parsed = parseEbsiLivePage(html, context);
    return { exams: parsed.exams, warnings: parsed.warnings };
  }
  const warnings: ParseWarning[] = [];
  const exams: DiscoveredExam[] = [];
  for (const item of legacyItems(html)) {
    const title = text(item.querySelector(LEGACY.examTitle));
    if (!title) throw new SourceStructureChangedError("ebsi", `exam title "${LEGACY.examTitle}" missing in item`);
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) {
      warnings.push({ code: "UNRECOGNIZED_TITLE", message: `${title}: ${canonical.reason}` });
      continue;
    }
    const dateText = text(item.querySelector(LEGACY.examDate));
    const dateMatch = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(dateText);
    const examDate = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[3]!.padStart(2, "0")}`
      : null;
    exams.push({
      externalId: legacyExternalId(item, canonical.exam),
      sourceUrl: context.pageUrl,
      title,
      canonical: canonical.exam,
      examDate,
      metadata: {
        listingGrade: context.grade,
        listingYear: context.year,
        artifactPageUrl: context.pageUrl,
      },
    });
  }
  return { exams, warnings };
}

export function parseEbsiExamArtifacts(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number; externalId: string },
): { artifacts: DiscoveredArtifact[]; warnings: ParseWarning[]; found: boolean } {
  if (html.includes("qus_box")) {
    const parsed = parseEbsiLivePage(html, context);
    const artifacts = parsed.artifactsByExternalId.get(context.externalId);
    return { artifacts: artifacts ?? [], warnings: parsed.warnings, found: Boolean(artifacts) };
  }
  const warnings: ParseWarning[] = [];
  const items = legacyItems(html);
  for (const item of items) {
    const title = text(item.querySelector(LEGACY.examTitle));
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) continue;
    if (legacyExternalId(item, canonical.exam) !== context.externalId) continue;
    const { artifacts, blocks } = legacyArtifactsFromItem(item, context.pageUrl, warnings);
    if (blocks === 0 && !items.some((i) => i.querySelector(LEGACY.subjectBlock)))
      throw new SourceStructureChangedError("ebsi", `no "${LEGACY.subjectBlock}" blocks in any item`);
    dedupeWarnings(warnings);
    return { artifacts, warnings, found: true };
  }
  return { artifacts: [], warnings, found: false };
}

export function parseEbsiListing(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: ParsedEbsiExam[]; warnings: ParseWarning[] } {
  if (html.includes("qus_box")) {
    const parsed = parseEbsiLivePage(html, context);
    return {
      exams: parsed.exams.map((exam) => ({
        ...exam,
        artifacts: parsed.artifactsByExternalId.get(exam.externalId) ?? [],
      })),
      warnings: parsed.warnings,
    };
  }
  const { exams, warnings } = parseEbsiExamList(html, context);
  const parsed: ParsedEbsiExam[] = [];
  const items = legacyItems(html);
  if (items.length > 0 && !items.some((i) => i.querySelector(LEGACY.subjectBlock)))
    throw new SourceStructureChangedError("ebsi", `no "${LEGACY.subjectBlock}" blocks in any item`);
  for (const exam of exams) {
    const res = parseEbsiExamArtifacts(html, { ...context, externalId: exam.externalId });
    warnings.push(...res.warnings);
    parsed.push({ ...exam, artifacts: res.artifacts });
  }
  dedupeWarnings(warnings);
  if (exams.length === 0 && warnings.length > 0)
    throw new SourceStructureChangedError("ebsi", "no exam title could be recognized", {
      warnings: warnings.slice(0, 5),
    });
  return { exams: parsed, warnings };
}

/** kept for callers that need a stable listing URL in metadata */
export { ebsiListingUrl };
