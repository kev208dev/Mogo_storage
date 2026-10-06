import type { Grade } from "../../../lib/constants";
import { classifyArtifact } from "../../canonical/classify";
import { canonicalizeExamTitle, canonicalKey } from "../../canonical/exam-title";
import { SourceStructureChangedError } from "../../errors";
import type { CanonicalExam, DiscoveredArtifact, DiscoveredExam } from "../../types";
import { absoluteUrl, extractLinkTarget, parseHtml, text, type HTMLElement } from "../html";
import { EBSI_STRUCTURE as S, ebsiArtifactPageUrl } from "./structure";

export interface ParsedEbsiExam extends DiscoveredExam {
  artifacts: DiscoveredArtifact[];
}

export interface ParseWarning {
  code: string;
  message: string;
}

/** 목록 항목(시험 하나)의 자료 링크 → DiscoveredArtifact (과목 블록 단위) */
function artifactsFromItem(
  item: HTMLElement,
  pageUrl: string,
  warnings: ParseWarning[],
): { artifacts: DiscoveredArtifact[]; blocks: number } {
  const artifacts: DiscoveredArtifact[] = [];
  const blocks = item.querySelectorAll(S.subjectBlock);
  for (const block of blocks) {
    const subjectLabel = text(block.querySelector(S.subjectName));
    for (const link of block.querySelectorAll(S.downloadLink)) {
      const label = text(link);
      const target = extractLinkTarget(link);
      const url = target ? absoluteUrl(target, pageUrl) : null;
      if (!url) continue;
      const result = classifyArtifact({ subjectLabel, linkLabel: label, url });
      if (!result.ok) {
        if (result.reason === "unsupported_subject") {
          warnings.push({ code: "UNSUPPORTED_SUBJECT", message: subjectLabel || label });
        }
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

function listItems(html: string) {
  const root = parseHtml(html);
  const container = root.querySelector(S.listContainer);
  if (!container) {
    if (root.querySelector(S.emptyMarker)) return [];
    throw new SourceStructureChangedError("ebsi", `list container "${S.listContainer}" not found`);
  }
  const items = container.querySelectorAll(S.examItem);
  if (items.length === 0) {
    if (container.querySelector(S.emptyMarker) || root.querySelector(S.emptyMarker)) return [];
    throw new SourceStructureChangedError("ebsi", `no "${S.examItem}" items and no empty marker`);
  }
  return items;
}

function itemExternalId(item: HTMLElement, exam: CanonicalExam): string {
  return item.getAttribute(S.examIdAttribute)?.trim() || `${canonicalKey(exam)}-${exam.examType}`;
}

/**
 * [Discovery] 시험 목록 페이지 → 시험 identity 목록. 자료 URL 은 보지 않는다.
 * (pageType: exam_list)
 */
export function parseEbsiExamList(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: DiscoveredExam[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = [];
  const exams: DiscoveredExam[] = [];
  for (const item of listItems(html)) {
    const title = text(item.querySelector(S.examTitle));
    if (!title) {
      throw new SourceStructureChangedError("ebsi", `exam title "${S.examTitle}" missing in item`);
    }
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) {
      warnings.push({ code: "UNRECOGNIZED_TITLE", message: `${title}: ${canonical.reason}` });
      continue;
    }
    const dateText = text(item.querySelector(S.examDate));
    const dateMatch = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(dateText);
    const examDate = dateMatch
      ? `${dateMatch[1]}-${dateMatch[2]!.padStart(2, "0")}-${dateMatch[3]!.padStart(2, "0")}`
      : null;
    exams.push({
      externalId: itemExternalId(item, canonical.exam),
      sourceUrl: context.pageUrl,
      title,
      canonical: canonical.exam,
      examDate,
      metadata: {
        listingGrade: context.grade,
        listingYear: context.year,
        artifactPageUrl: ebsiArtifactPageUrl(context.pageUrl),
      },
    });
  }
  return { exams, warnings };
}

/**
 * [Artifact discovery] 특정 시험의 자료(문제/정답/해설/음원/대본) URL.
 * 현재 구조 가정(EBSI_STRUCTURE.artifactPage = "listing")에서는 목록 항목 안에 자료 링크가 있으므로
 * 자료 페이지 = 목록 페이지이고, externalId 로 해당 시험 항목만 읽는다.
 * (pageType: exam_detail — 실제 사이트가 별도 상세 페이지면 structure 와 이 함수만 바꾼다)
 */
export function parseEbsiExamArtifacts(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number; externalId: string },
): { artifacts: DiscoveredArtifact[]; warnings: ParseWarning[]; found: boolean } {
  const warnings: ParseWarning[] = [];
  const items = listItems(html);
  for (const item of items) {
    const title = text(item.querySelector(S.examTitle));
    const canonical = canonicalizeExamTitle(title, { grade: context.grade, year: context.year });
    if (!canonical.ok) continue;
    if (itemExternalId(item, canonical.exam) !== context.externalId) continue;
    const { artifacts, blocks } = artifactsFromItem(item, context.pageUrl, warnings);
    // 아직 자료가 없는 시험은 정상이지만, 페이지 전체에 과목 블록이 하나도 없으면 구조 변경
    if (blocks === 0 && !items.some((i) => i.querySelector(S.subjectBlock))) {
      throw new SourceStructureChangedError("ebsi", `no "${S.subjectBlock}" blocks in any item`);
    }
    dedupeWarnings(warnings);
    return { artifacts, warnings, found: true };
  }
  return { artifacts: [], warnings, found: false };
}

/**
 * 목록 + 자료를 한 번에 (fixture contract, dry-run, 기존 테스트용).
 * 내부적으로 parseEbsiExamList → parseEbsiExamArtifacts 를 차례로 쓴다.
 */
export function parseEbsiListing(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: ParsedEbsiExam[]; warnings: ParseWarning[] } {
  const { exams, warnings } = parseEbsiExamList(html, context);
  const parsed: ParsedEbsiExam[] = [];
  const items = listItems(html);
  if (items.length > 0 && !items.some((i) => i.querySelector(S.subjectBlock))) {
    throw new SourceStructureChangedError("ebsi", `no "${S.subjectBlock}" blocks in any item`);
  }
  for (const exam of exams) {
    const res = parseEbsiExamArtifacts(html, { ...context, externalId: exam.externalId });
    warnings.push(...res.warnings);
    parsed.push({ ...exam, artifacts: res.artifacts });
  }
  dedupeWarnings(warnings);
  if (exams.length === 0 && warnings.length > 0) {
    throw new SourceStructureChangedError("ebsi", "no exam title could be recognized", {
      warnings: warnings.slice(0, 5),
    });
  }
  return { exams: parsed, warnings };
}
