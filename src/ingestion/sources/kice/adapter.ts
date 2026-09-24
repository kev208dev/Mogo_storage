import { canonicalKey } from "../../canonical/exam-title";
import { IngestionError } from "../../errors";
import { decodeHtml, type Fetcher } from "../../net/fetcher";
import type {
  DiscoveredArtifact,
  DiscoveredReleaseTime,
  ExamLocator,
  SourceConfig,
} from "../../types";
import { BoardExamSource } from "../board/adapter";
import { parseKiceExamIndex, type ParsedExamIndex } from "./index-parser";
import { KICE_DEFINITION } from "./structure";

/**
 * 평가원 시행 시험(6·9월 모의평가, 수능)의 canonical source.
 *  - 게시판(기출문제 목록/첨부파일): BoardExamSource 공통 parser
 *  - 시험별 자료 index 페이지(교시·영역·정답 공개시간·문제·정답·듣기·대본 표): KiceExamIndexParser
 *    index URL 은 운영자가 공식 공지에서 확인해 일정(sourcePages)에 등록한다 — URL 규칙을 추측하지 않는다.
 */
export class KiceExamSource extends BoardExamSource {
  private readonly indexCache = new Map<string, Promise<ParsedExamIndex>>();

  constructor(
    source: SourceConfig,
    private readonly kiceFetcher: Fetcher,
    now?: () => Date,
  ) {
    super(source, KICE_DEFINITION, kiceFetcher, now);
  }

  private async index(exam: ExamLocator): Promise<ParsedExamIndex> {
    const parsed = await this.fetchIndex(exam);
    // 등록된 index URL 이 다른 시험 페이지면 자료를 섞지 않는다
    if (parsed.exam && canonicalKey(parsed.exam) !== canonicalKey(exam)) {
      throw new IngestionError(
        "INDEX_EXAM_MISMATCH",
        `index page is for ${canonicalKey(parsed.exam)}, expected ${canonicalKey(exam)}`,
      );
    }
    return parsed;
  }

  private fetchIndex(exam: ExamLocator): Promise<ParsedExamIndex> {
    const url = exam.sourceUrl!;
    if (!this.indexCache.has(url)) {
      this.indexCache.set(
        url,
        this.kiceFetcher.fetch(url, { accept: "text/html" }).then((res) =>
          parseKiceExamIndex(decodeHtml(res), {
            pageUrl: res.url,
            examDate: exam.examDate ?? null,
          }),
        ),
      );
    }
    return this.indexCache.get(url)!;
  }

  override async discoverArtifacts(exam: ExamLocator): Promise<DiscoveredArtifact[]> {
    if (exam.pageType === "exam_release_index" && exam.sourceUrl) {
      return (await this.index(exam)).artifacts;
    }
    return super.discoverArtifacts(exam);
  }

  async discoverReleaseTimes(exam: ExamLocator): Promise<DiscoveredReleaseTime[]> {
    if (exam.pageType !== "exam_release_index" || !exam.sourceUrl) return [];
    return (await this.index(exam)).releaseTimes;
  }
}
