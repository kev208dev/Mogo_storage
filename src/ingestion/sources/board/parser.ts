import { classifyArtifact } from "../../canonical/classify";
import { canonicalizeExamTitle, type TitleHints } from "../../canonical/exam-title";
import { SourceStructureChangedError } from "../../errors";
import type { DiscoveredArtifact, DiscoveredExam } from "../../types";
import { absoluteUrl, extractLinkTarget, parseHtml, text } from "../html";

/**
 * 게시판형 공식 자료실(평가원, 교육청 등) 공통 parser.
 * 목록: 게시글(시험) 목록 / 상세: 첨부파일 목록 구조. 사이트별 selector 는 BoardStructure 로 주입한다.
 */
export interface BoardStructure {
  sourceId: string;
  listRow: string;
  rowTitleLink: string;
  rowDate: string;
  emptyMarker: string;
  /** 상세 페이지 URL 에서 게시글 id 로 쓸 query 파라미터 */
  idParam: string;
  attachmentContainer: string;
  attachmentLink: string;
  /** 게시글 제목에 이 패턴이 없으면 시험 자료 글이 아니다 (공지 등) */
  examTitlePattern: RegExp;
}

export interface BoardListResult {
  exams: DiscoveredExam[];
  skipped: string[];
  isEmpty: boolean;
}

export function parseBoardList(
  html: string,
  structure: BoardStructure,
  context: { pageUrl: string; hints?: TitleHints },
): BoardListResult {
  const root = parseHtml(html);
  const rows = root.querySelectorAll(structure.listRow);
  if (rows.length === 0) {
    if (root.querySelector(structure.emptyMarker)) return { exams: [], skipped: [], isEmpty: true };
    throw new SourceStructureChangedError(structure.sourceId, `no rows "${structure.listRow}"`);
  }
  const exams: DiscoveredExam[] = [];
  const skipped: string[] = [];
  let linksSeen = 0;
  for (const row of rows) {
    const link = row.querySelector(structure.rowTitleLink);
    if (!link) continue; // 공지/빈 행
    linksSeen += 1;
    const title = text(link);
    if (!title) throw new SourceStructureChangedError(structure.sourceId, "row title is empty");
    if (!structure.examTitlePattern.test(title)) {
      skipped.push(title);
      continue;
    }
    const canonical = canonicalizeExamTitle(title, context.hints);
    if (!canonical.ok) {
      skipped.push(`${title} (${canonical.reason})`);
      continue;
    }
    const target = extractLinkTarget(link);
    const url = target ? absoluteUrl(target, context.pageUrl) : null;
    if (!url)
      throw new SourceStructureChangedError(structure.sourceId, `row link missing: ${title}`);
    const externalId = new URL(url).searchParams.get(structure.idParam);
    if (!externalId) {
      throw new SourceStructureChangedError(
        structure.sourceId,
        `detail url has no "${structure.idParam}" parameter`,
      );
    }
    const dateText = text(row.querySelector(structure.rowDate));
    const date = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(dateText);
    exams.push({
      externalId,
      sourceUrl: url,
      title,
      canonical: canonical.exam,
      examDate: null,
      metadata: {
        postedAt: date
          ? `${date[1]}-${date[2]!.padStart(2, "0")}-${date[3]!.padStart(2, "0")}`
          : null,
      },
    });
  }
  if (linksSeen === 0) {
    // "게시물이 없습니다" 한 줄만 있는 빈 페이지
    if (root.querySelector(structure.emptyMarker)) return { exams: [], skipped, isEmpty: true };
    throw new SourceStructureChangedError(
      structure.sourceId,
      `no "${structure.rowTitleLink}" links`,
    );
  }
  return { exams, skipped, isEmpty: false };
}

export function parseBoardAttachments(
  html: string,
  structure: BoardStructure,
  context: { pageUrl: string; postedAt?: string | null },
): DiscoveredArtifact[] {
  const root = parseHtml(html);
  const container = root.querySelector(structure.attachmentContainer);
  if (!container) {
    throw new SourceStructureChangedError(
      structure.sourceId,
      `attachment container "${structure.attachmentContainer}" not found`,
    );
  }
  const artifacts: DiscoveredArtifact[] = [];
  for (const link of container.querySelectorAll(structure.attachmentLink)) {
    const label = text(link);
    const target = extractLinkTarget(link);
    const url = target ? absoluteUrl(target, context.pageUrl) : null;
    if (!url || !label) continue;
    const result = classifyArtifact({
      subjectLabel: null,
      linkLabel: label,
      url,
      publishedAt: context.postedAt ? `${context.postedAt}T00:00:00+09:00` : null,
    });
    if (result.ok) artifacts.push(result.artifact);
  }
  return artifacts;
}
