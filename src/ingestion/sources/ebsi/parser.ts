import type { Grade } from "../../../lib/constants";
import { classifyArtifact } from "../../canonical/classify";
import { canonicalizeExamTitle, canonicalKey } from "../../canonical/exam-title";
import { SourceStructureChangedError } from "../../errors";
import type { CanonicalExam, DiscoveredArtifact, DiscoveredExam } from "../../types";
import {
  absoluteUrl,
  compact,
  extractLinkTarget,
  parseHtml,
  text,
  type HTMLElement,
} from "../html";
import { EBSI_STRUCTURE as S, ebsiArtifactPageUrl } from "./structure";

export interface ParsedEbsiExam extends DiscoveredExam {
  artifacts: DiscoveredArtifact[];
}

export interface ParseWarning {
  code: string;
  message: string;
}

const SEMANTIC_ITEM_SELECTOR = "li, tr, article, section, div";
const SEMANTIC_TITLE_SELECTOR = "h1, h2, h3, h4, h5, strong, b, p, span, th, td, a, button";
const DOWNLOAD_SELECTOR = "a, button";

function firstCanonicalTitle(
  item: HTMLElement,
  context: { grade: Grade; year: number },
): string | null {
  const configured = text(item.querySelector(S.examTitle));
  if (configured) {
    const canonical = canonicalizeExamTitle(configured, context);
    if (canonical.ok) return configured;
  }

  const own = text(item);
  if (own && own.length <= 180) {
    const canonical = canonicalizeExamTitle(own, context);
    if (canonical.ok) return own;
  }

  for (const candidate of item.querySelectorAll(SEMANTIC_TITLE_SELECTOR)) {
    const value = text(candidate);
    if (!value || value.length > 180) continue;
    const canonical = canonicalizeExamTitle(value, context);
    if (canonical.ok) return value;
  }
  return null;
}

function dateFromItem(item: HTMLElement): string | null {
  const configured = text(item.querySelector(S.examDate));
  const source = configured || text(item);
  const match = /(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/.exec(source);
  if (!match) return null;
  return `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
}

function semanticExamItems(
  root: HTMLElement,
  context: { grade: Grade; year: number },
): HTMLElement[] {
  const candidates = root
    .querySelectorAll(SEMANTIC_ITEM_SELECTOR)
    .filter((item) => Boolean(firstCanonicalTitle(item, context)));

  return candidates.filter((item) => {
    const title = firstCanonicalTitle(item, context);
    if (!title) return false;
    const parsedTitle = canonicalizeExamTitle(title, context);
    if (!parsedTitle.ok) return false;
    const key = canonicalKey(parsedTitle.exam);
    return !candidates.some((other) => {
      if (other === item) return false;
      let parent = other.parentNode;
      let inside = false;
      while (parent) {
        if (parent === item) {
          inside = true;
          break;
        }
        parent = parent.parentNode;
      }
      if (!inside) return false;
      const otherTitle = firstCanonicalTitle(other, context);
      if (!otherTitle) return false;
      const parsed = canonicalizeExamTitle(otherTitle, context);
      return parsed.ok && canonicalKey(parsed.exam) === key;
    });
  });
}

function examItems(
  html: string,
  context: { grade: Grade; year: number },
): { items: HTMLElement[]; mode: "configured" | "semantic" } {
  const root = parseHtml(html);
  const container = root.querySelector(S.listContainer);
  if (container) {
    const items = container.querySelectorAll(S.examItem);
    if (items.length > 0) return { items, mode: "configured" };
    if (container.querySelector(S.emptyMarker) || root.querySelector(S.emptyMarker))
      return { items: [], mode: "configured" };
  }
  if (root.querySelector(S.emptyMarker)) return { items: [], mode: "configured" };

  const items = semanticExamItems(root, context);
  if (items.length > 0) return { items, mode: "semantic" };

  const shell = compact(text(root));
  if (/기출문제상세조건|시행연도|시행월/.test(shell)) {
    throw new SourceStructureChangedError(
      "ebsi",
      "exam results are not present in server-rendered HTML (dynamic result endpoint required)",
    );
  }
  throw new SourceStructureChangedError(
    "ebsi",
    `list container "${S.listContainer}" not found and semantic fallback found no exams`,
  );
}

function artifactsFromItem(
  item: HTMLElement,
  pageUrl: string,
  warnings: ParseWarning[],
): { artifacts: DiscoveredArtifact[]; blocks: number } {
  const artifacts: DiscoveredArtifact[] = [];
  const seen = new Set<string>();
  const configuredBlocks = item.querySelectorAll(S.subjectBlock);

  const consume = (link: HTMLElement, subjectLabel: string | null) => {
    const label = text(link) || link.getAttribute("title") || link.getAttribute("aria-label") || "";
    const target = extractLinkTarget(link);
    const url = target ? absoluteUrl(target, pageUrl) : null;
    if (!url || seen.has(url)) return;
    const result = classifyArtifact({ subjectLabel, linkLabel: label, url });
    if (!result.ok) {
      if (result.reason === "unsupported_subject" && (subjectLabel || label)) {
        warnings.push({
          code: "UNSUPPORTED_SUBJECT",
          message: subjectLabel || label || url,
        });
      }
      return;
    }
    seen.add(url);
    artifacts.push(result.artifact);
  };

  if (configuredBlocks.length > 0) {
    for (const block of configuredBlocks) {
      const subjectLabel = text(block.querySelector(S.subjectName));
      for (const link of block.querySelectorAll(S.downloadLink))
        consume(link, subjectLabel || null);
    }
    return { artifacts, blocks: configuredBlocks.length };
  }

  const links = item.querySelectorAll(DOWNLOAD_SELECTOR);
  for (const link of links) {
    let subjectLabel: string | null = null;
    let parent = link.parentNode as HTMLElement | null;
    let depth = 0;
    while (parent && parent !== item && depth < 4) {
      const candidate = text(parent);
      if (candidate && candidate.length <= 160) {
        subjectLabel = candidate;
        break;
      }
      parent = parent.parentNode as HTMLElement | null;
      depth += 1;
    }
    consume(link, subjectLabel);
  }
  return { artifacts, blocks: links.length > 0 ? 1 : 0 };
}

function dedupeWarnings(warnings: ParseWarning[]) {
  const seen = new Set<string>();
  for (let i = warnings.length - 1; i >= 0; i -= 1) {
    const key = `${warnings[i]!.code}:${warnings[i]!.message}`;
    if (seen.has(key)) warnings.splice(i, 1);
    seen.add(key);
  }
}

function itemExternalId(
  item: HTMLElement,
  exam: CanonicalExam,
  context: { pageUrl: string },
): string {
  const configured = item.getAttribute(S.examIdAttribute)?.trim();
  if (configured) return configured;

  for (const attr of ["data-irecord", "data-record", "data-id", "data-exam-id"]) {
    const value = item.getAttribute(attr)?.trim();
    if (value) return value;
  }

  for (const link of item.querySelectorAll("a, button")) {
    const target = extractLinkTarget(link);
    if (!target) continue;
    try {
      const u = new URL(target, context.pageUrl);
      for (const key of ["irecord", "record", "examId", "examNo"]) {
        const value = u.searchParams.get(key);
        if (value) return value;
      }
    } catch {
      // canonical key fallback
    }
  }
  return `${canonicalKey(exam)}-${exam.examType}`;
}

export function parseEbsiExamList(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: DiscoveredExam[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const exams: DiscoveredExam[] = [];
  const { items, mode } = examItems(html, context);

  for (const item of items) {
    const configuredTitle = text(item.querySelector(S.examTitle));
    const title = configuredTitle || firstCanonicalTitle(item, context);
    if (!title) {
      if (mode === "configured") {
        throw new SourceStructureChangedError(
          "ebsi",
          `exam title "${S.examTitle}" missing in item`,
        );
      }
      continue;
    }
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) {
      warnings.push({ code: "UNRECOGNIZED_TITLE", message: `${title}: ${canonical.reason}` });
      continue;
    }
    exams.push({
      externalId: itemExternalId(item, canonical.exam, { pageUrl: context.pageUrl }),
      sourceUrl: context.pageUrl,
      title,
      canonical: canonical.exam,
      examDate: dateFromItem(item),
      metadata: {
        listingGrade: context.grade,
        listingYear: context.year,
        artifactPageUrl: ebsiArtifactPageUrl(context.pageUrl),
        parserMode: mode,
      },
    });
  }

  if (items.length > 0 && exams.length === 0) {
    throw new SourceStructureChangedError("ebsi", "no exam title could be recognized", {
      warnings: warnings.slice(0, 5),
    });
  }
  return { exams, warnings };
}

export function parseEbsiExamArtifacts(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number; externalId: string },
): { artifacts: DiscoveredArtifact[]; warnings: ParseWarning[]; found: boolean } {
  const warnings: ParseWarning[] = [];
  const { items } = examItems(html, context);

  for (const item of items) {
    const title = text(item.querySelector(S.examTitle)) || firstCanonicalTitle(item, context);
    if (!title) continue;
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) continue;
    if (itemExternalId(item, canonical.exam, { pageUrl: context.pageUrl }) !== context.externalId)
      continue;

    const { artifacts, blocks } = artifactsFromItem(item, context.pageUrl, warnings);
    if (blocks === 0) {
      throw new SourceStructureChangedError(
        "ebsi",
        "exam item found but no downloadable artifact links were present",
      );
    }
    dedupeWarnings(warnings);
    return { artifacts, warnings, found: true };
  }
  return { artifacts: [], warnings, found: false };
}

export function parseEbsiListing(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: ParsedEbsiExam[]; warnings: ParseWarning[] } {
  const { exams, warnings } = parseEbsiExamList(html, context);
  const parsed: ParsedEbsiExam[] = [];
  for (const exam of exams) {
    const res = parseEbsiExamArtifacts(html, { ...context, externalId: exam.externalId });
    warnings.push(...res.warnings);
    parsed.push({ ...exam, artifacts: res.artifacts });
  }
  dedupeWarnings(warnings);
  return { exams: parsed, warnings };
}
