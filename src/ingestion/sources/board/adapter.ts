import { canonicalKey } from "../../canonical/exam-title";
import { healthStatusForError, toIngestionError } from "../../errors";
import { decodeHtml, type Fetcher } from "../../net/fetcher";
import type {
  DiscoverOptions,
  DiscoveredArtifact,
  DiscoveredExam,
  ExamLocator,
  ExamSourceAdapter,
  SourceConfig,
  SourceHealth,
} from "../../types";
import { parseBoardAttachments, parseBoardList, type BoardStructure } from "./parser";

export interface BoardSourceDefinition {
  structure: BoardStructure;
  /** 목록 페이지 URL (1부터) */
  listUrl(baseUrl: string, page: number): string;
  maxPages: number;
}

/** 게시판형 공식 자료실 공통 adapter (KICE, 교육청 등) */
export class BoardExamSource implements ExamSourceAdapter {
  private readonly pageCache = new Map<number, Promise<DiscoveredExam[]>>();

  constructor(
    readonly source: SourceConfig,
    private readonly definition: BoardSourceDefinition,
    private readonly fetcher: Fetcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private page(page: number): Promise<DiscoveredExam[]> {
    if (!this.pageCache.has(page)) {
      const url = this.definition.listUrl(this.source.baseUrl, page);
      this.pageCache.set(
        page,
        this.fetcher
          .fetch(url, { accept: "text/html" })
          .then(
            (res) =>
              parseBoardList(decodeHtml(res), this.definition.structure, { pageUrl: url }).exams,
          ),
      );
    }
    return this.pageCache.get(page)!;
  }

  async discoverExams(options: DiscoverOptions): Promise<DiscoveredExam[]> {
    const from = options.fromYear ?? this.now().getFullYear();
    const to = options.toYear ?? this.now().getFullYear();
    const found = new Map<string, DiscoveredExam>();
    for (let page = 1; page <= this.definition.maxPages; page += 1) {
      options.signal?.throwIfAborted();
      const exams = await this.page(page);
      if (exams.length === 0) break;
      for (const exam of exams) {
        const c = exam.canonical;
        if (c.year < from || c.year > to) continue;
        if (options.grade && c.grade !== options.grade) continue;
        if (options.month && c.month !== options.month) continue;
        found.set(exam.externalId, exam);
      }
      // 게시판은 최신순: 페이지의 가장 오래된 글이 from 보다 이전이면 중단
      if (Math.min(...exams.map((e) => e.canonical.year)) < from) break;
    }
    return [...found.values()];
  }

  async discoverArtifacts(exam: ExamLocator): Promise<DiscoveredArtifact[]> {
    let detailUrl = exam.sourceUrl;
    let postedAt: string | null = null;
    if (!detailUrl) {
      const key = canonicalKey(exam);
      const candidates = await this.discoverExams({ fromYear: exam.year, toYear: exam.year + 1 });
      const match = candidates.find(
        (e) => canonicalKey(e.canonical) === key && e.canonical.examType === exam.examType,
      );
      if (!match) return [];
      detailUrl = match.sourceUrl;
      postedAt = (match.metadata.postedAt as string | null) ?? null;
    }
    const res = await this.fetcher.fetch(detailUrl, { accept: "text/html" });
    return parseBoardAttachments(decodeHtml(res), this.definition.structure, {
      pageUrl: detailUrl,
      postedAt,
    });
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = this.now().toISOString();
    if (!this.source.enabled) return { status: "disabled", checkedAt, message: "source disabled" };
    try {
      const exams = await this.page(1);
      // 실제 구조 검증 여부는 DB(exam_sources.verified_*)가 판단한다. 여기서는 요청·파싱 결과만 보고한다
      return { status: "healthy", checkedAt, message: `parsed ${exams.length} exams on page 1` };
    } catch (error) {
      const e = toIngestionError(error);
      return {
        status: healthStatusForError(e),
        checkedAt,
        message: `${e.code}: ${e.message}`,
      };
    }
  }
}
