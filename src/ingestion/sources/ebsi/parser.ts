import type { Grade } from "../../../lib/constants";
import { classifyArtifact } from "../../canonical/classify";
import { canonicalizeExamTitle, canonicalKey } from "../../canonical/exam-title";
import { SourceStructureChangedError } from "../../errors";
import type { DiscoveredArtifact, DiscoveredExam } from "../../types";
import { absoluteUrl, extractLinkTarget, parseHtml, text } from "../html";
import { EBSI_STRUCTURE as S } from "./structure";

export interface ParsedEbsiExam extends DiscoveredExam {
  artifacts: DiscoveredArtifact[];
}

export interface ParseWarning {
  code: string;
  message: string;
}

/** EBSi 기출 목록 HTML → canonical 시험 + 자료 목록 (순수 함수, 네트워크 없음) */
export function parseEbsiListing(
  html: string,
  context: { pageUrl: string; grade: Grade; year: number },
): { exams: ParsedEbsiExam[]; warnings: ParseWarning[] } {
  const root = parseHtml(html);
  const container = root.querySelector(S.listContainer);
  if (!container) {
    if (root.querySelector(S.emptyMarker)) return { exams: [], warnings: [] };
    throw new SourceStructureChangedError("ebsi", `list container "${S.listContainer}" not found`);
  }
  const items = container.querySelectorAll(S.examItem);
  if (items.length === 0) {
    if (container.querySelector(S.emptyMarker) || root.querySelector(S.emptyMarker)) {
      return { exams: [], warnings: [] };
    }
    throw new SourceStructureChangedError("ebsi", `no "${S.examItem}" items and no empty marker`);
  }

  const warnings: ParseWarning[] = [];
  const exams: ParsedEbsiExam[] = [];
  let subjectBlocksSeen = 0;

  for (const item of items) {
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

    const artifacts: DiscoveredArtifact[] = [];
    const blocks = item.querySelectorAll(S.subjectBlock);
    subjectBlocksSeen += blocks.length;
    for (const block of blocks) {
      const subjectLabel = text(block.querySelector(S.subjectName));
      for (const link of block.querySelectorAll(S.downloadLink)) {
        const label = text(link);
        const target = extractLinkTarget(link);
        const url = target ? absoluteUrl(target, context.pageUrl) : null;
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
    // 같은 과목 블록에서 경고가 중복되지 않도록 정리
    const seen = new Set<string>();
    for (let i = warnings.length - 1; i >= 0; i -= 1) {
      const key = `${warnings[i]!.code}:${warnings[i]!.message}`;
      if (seen.has(key)) warnings.splice(i, 1);
      seen.add(key);
    }

    exams.push({
      externalId:
        item.getAttribute(S.examIdAttribute)?.trim() ||
        `${canonicalKey(canonical.exam)}-${canonical.exam.examType}`,
      sourceUrl: context.pageUrl,
      title,
      canonical: canonical.exam,
      examDate,
      metadata: { listingGrade: context.grade, listingYear: context.year },
      artifacts,
    });
  }

  if (subjectBlocksSeen === 0) {
    throw new SourceStructureChangedError("ebsi", `no "${S.subjectBlock}" blocks in any item`);
  }
  if (exams.length === 0 && warnings.length > 0) {
    throw new SourceStructureChangedError("ebsi", "no exam title could be recognized", {
      warnings: warnings.slice(0, 5),
    });
  }
  return { exams, warnings };
}
