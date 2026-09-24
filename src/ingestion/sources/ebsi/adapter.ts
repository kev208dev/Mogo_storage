import { GRADES, type Grade } from "../../../lib/constants";
import { canonicalKey } from "../../canonical/exam-title";
import { IngestionError, toIngestionError } from "../../errors";
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
import { parseEbsiListing, type ParsedEbsiExam } from "./parser";
import { ebsiListingUrl, EBSI_STRUCTURE } from "./structure";

export class EbsiExamSource implements ExamSourceAdapter {
  /** 한 번의 실행 안에서 같은 목록 페이지를 두 번 요청하지 않는다 */
  private readonly listingCache = new Map<string, Promise<ParsedEbsiExam[]>>();

  constructor(
    readonly source: SourceConfig,
    private readonly fetcher: Fetcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private listing(grade: Grade, year: number): Promise<ParsedEbsiExam[]> {
    const url = ebsiListingUrl(this.source.baseUrl, grade, year);
    if (!this.listingCache.has(url)) {
      this.listingCache.set(
        url,
        this.fetcher.fetch(url, { accept: "text/html" }).then((res) => {
          const { exams } = parseEbsiListing(decodeHtml(res), { pageUrl: url, grade, year });
          // 목록 페이지가 다른 연도 시험을 섞어 보여줘도 해당 연도만 사용
          return exams.filter((e) => e.canonical.year === year);
        }),
      );
    }
    return this.listingCache.get(url)!;
  }

  async discoverExams(options: DiscoverOptions): Promise<DiscoveredExam[]> {
    const currentYear = this.now().getFullYear();
    const from = options.fromYear ?? currentYear;
    const to = options.toYear ?? currentYear;
    const grades = options.grade ? [options.grade] : [...GRADES];
    const found: DiscoveredExam[] = [];
    for (let year = to; year >= from; year -= 1) {
      for (const grade of grades) {
        options.signal?.throwIfAborted();
        const exams = await this.listing(grade, year);
        for (const exam of exams) {
          if (options.month && exam.canonical.month !== options.month) continue;
          const { artifacts: _artifacts, ...discovered } = exam;
          void _artifacts;
          found.push(discovered);
        }
      }
    }
    return found;
  }

  async discoverArtifacts(exam: ExamLocator): Promise<DiscoveredArtifact[]> {
    const exams = await this.listing(exam.grade, exam.year);
    const key = canonicalKey(exam);
    const match = exams.find(
      (e) =>
        (exam.externalId && e.externalId === exam.externalId) ||
        (canonicalKey(e.canonical) === key && e.canonical.examType === exam.examType),
    );
    return match?.artifacts ?? [];
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = this.now().toISOString();
    if (!this.source.enabled) {
      return { status: "disabled", checkedAt, message: "source disabled" };
    }
    try {
      const exams = await this.listing(3, this.now().getFullYear());
      return {
        status: EBSI_STRUCTURE.verifiedAgainstLivePage ? "healthy" : "degraded",
        checkedAt,
        message: EBSI_STRUCTURE.verifiedAgainstLivePage
          ? `parsed ${exams.length} exams`
          : `parsed ${exams.length} exams (parser not yet verified against live page)`,
      };
    } catch (error) {
      const e = toIngestionError(error);
      return {
        status: e instanceof IngestionError && e.retryable ? "degraded" : "broken",
        checkedAt,
        message: `${e.code}: ${e.message}`,
      };
    }
  }
}
