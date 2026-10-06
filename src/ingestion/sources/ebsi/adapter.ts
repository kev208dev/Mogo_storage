import { GRADES, type Grade } from "../../../lib/constants";
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
import { parseEbsiExamArtifacts, parseEbsiExamList } from "./parser";
import { ebsiArtifactPageUrl, ebsiListingUrl } from "./structure";

export class EbsiExamSource implements ExamSourceAdapter {
  /** 한 번의 실행 안에서 같은 페이지를 두 번 요청하지 않는다 (목록 = 자료 페이지인 현재 구조에서 중요) */
  private readonly pageCache = new Map<string, Promise<string>>();

  constructor(
    readonly source: SourceConfig,
    private readonly fetcher: Fetcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private page(url: string): Promise<string> {
    if (!this.pageCache.has(url)) {
      this.pageCache.set(
        url,
        this.fetcher.fetch(url, { accept: "text/html" }).then((res) => decodeHtml(res)),
      );
    }
    return this.pageCache.get(url)!;
  }

  /** [Discovery] 학년·연도별 시험 목록 (pageType exam_list) */
  private async listing(grade: Grade, year: number): Promise<DiscoveredExam[]> {
    const url = ebsiListingUrl(this.source.baseUrl, grade, year);
    const { exams } = parseEbsiExamList(await this.page(url), { pageUrl: url, grade, year });
    // 목록 페이지가 다른 연도 시험을 섞어 보여줘도 해당 연도만 사용
    return exams.filter((e) => e.canonical.year === year);
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
        for (const exam of await this.listing(grade, year)) {
          if (options.month && exam.canonical.month !== options.month) continue;
          found.push(exam);
        }
      }
    }
    return found;
  }

  /**
   * [Artifact discovery] 시험 하나의 자료 URL. 시험 목록과 별개 단계다.
   * externalId 가 없으면(release watch 등) 목록에서 canonical identity 로 찾는다.
   */
  async discoverArtifacts(exam: ExamLocator): Promise<DiscoveredArtifact[]> {
    let externalId = exam.externalId;
    if (!externalId) {
      const key = canonicalKey(exam);
      const match = (await this.listing(exam.grade, exam.year)).find(
        (e) => canonicalKey(e.canonical) === key && e.canonical.examType === exam.examType,
      );
      if (!match) return [];
      externalId = match.externalId;
    }
    const listingUrl = ebsiListingUrl(this.source.baseUrl, exam.grade, exam.year);
    const pageUrl = ebsiArtifactPageUrl(listingUrl);
    const { artifacts } = parseEbsiExamArtifacts(await this.page(pageUrl), {
      pageUrl,
      grade: exam.grade,
      year: exam.year,
      externalId,
    });
    return artifacts;
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = this.now().toISOString();
    if (!this.source.enabled) {
      return { status: "disabled", checkedAt, message: "source disabled" };
    }
    try {
      const exams = await this.listing(3, this.now().getFullYear());
      // 실제 구조 검증 여부는 DB(exam_sources.verified_*)가 판단한다. 여기서는 요청·파싱 결과만 보고한다
      return { status: "healthy", checkedAt, message: `parsed ${exams.length} exams` };
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
