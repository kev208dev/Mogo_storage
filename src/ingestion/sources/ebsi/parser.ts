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

  // 동일 시험이 바깥 div / 안쪽 row 양쪽에서 잡히는 경우 가장 작은 컨테이너만 남긴다.
  return candidates.filter((item) => {
    const title = firstCanonicalTitle(item, context);
    if (!title) return false;
    const key = canonicalKey(canonicalizeExamTitle(title, context).exam!);
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

  // 검색/필터 shell 만 있고 서버 HTML 에 실제 시험 결과가 없는 경우를 구분한다.
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

/** 목록 항목(시험 하나)의 자료 링크 → DiscoveredArtifact */
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
      for (const link of block.querySelectorAll(S.downloadLink)) consume(link, subjectLabel || null);
    }
    return { artifacts, blocks: configuredBlocks.length };
  }

  // 현행 EBSi 처럼 table/div 기반으로 바뀐 경우: 링크의 가장 가까운 작은 컨테이너 텍스트를
  // subjectLabel 로 사용한다. classifyArtifact 가 과목/자료종류를 확정하지 못하면 공개 후보가 되지 않는다.
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

/**
 * [Discovery] 학년·연도별 시험 목록 (pageType: exam_list).
 * 기존 class contract 를 우선 사용하고, EBSi 가 table/div markup 으로 바뀐 경우
 * 시험명/날짜를 의미 기반으로 찾는 fallback 을 사용한다.
 */
export function parseEbsiExamList(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: DiscoveredExam[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const exams: DiscoveredExam[] = [];
  const { items, mode } = examItems(html, context);

  for (const item of items) {
    const title = firstCanonicalTitle(item, context);
    if (!title) {
      if (mode === "configured") {
        throw new SourceStructureChangedError("ebsi", `exam title "${S.examTitle}" missing in item`);
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

/**
 * [Artifact discovery] 특정 시험의 자료(문제/정답/해설/음원/대본) URL.
 * 목록 항목에 다운로드 링크가 있으면 그대로 사용한다. 링크가 client-side result 로만
 * 제공되는 페이지라면 found=true/artifacts=[] 로 조용히 성공시키지 않고 구조 변경으로 판단한다.
 */
export function parseEbsiExamArtifacts(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number; externalId: string },
): { artifacts: DiscoveredArtifact[]; warnings: ParseWarning[]; found: boolean } {
  const warnings: ParseWarning[] = [];
  const { items } = examItems(html, context);

  for (const item of items) {
    const title = firstCanonicalTitle(item, context);
    if (!title) continue;
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) continue;
    if (
      itemExternalId(item, canonical.exam, { pageUrl: context.pageUrl }) !== context.externalId
    )
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

/**
 * 목록 + 자료를 한 번에 (fixture contract, dry-run, 기존 테스트용).
 */
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
