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
import { parseEbsiLivePage } from "./parser";
import {
  ebsiListAjaxUrl,
  ebsiListBody,
  ebsiListingUrl,
  EBSI_AREA_ORDERS,
  EBSI_STRUCTURE,
} from "./structure";

const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "x-requested-with": "XMLHttpRequest",
} as const;

export class EbsiExamSource implements ExamSourceAdapter {
  constructor(
    readonly source: SourceConfig,
    private readonly fetcher: Fetcher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async page(input: {
    grade: Grade;
    year: number;
    month?: number | null;
    areaOrders?: readonly string[];
    page?: number;
  }): Promise<ReturnType<typeof parseEbsiLivePage>> {
    const ajaxUrl = ebsiListAjaxUrl(this.source.baseUrl);
    const listingUrl = ebsiListingUrl(this.source.baseUrl, input.grade, input.year);
    const body = ebsiListBody(input);
    const res = await this.fetcher.fetch(ajaxUrl, {
      method: "POST",
      accept: "text/html,*/*",
      headers: { ...FORM_HEADERS, referer: listingUrl },
      body: body.toString(),
      maxBytes: 4 * 1024 * 1024,
    });
    return parseEbsiLivePage(decodeHtml(res), {
      pageUrl: listingUrl,
      grade: input.grade,
      year: input.year,
    });
  }

  private async pages(input: {
    grade: Grade;
    year: number;
    month?: number | null;
    areaOrders?: readonly string[];
  }) {
    const out: Array<Awaited<ReturnType<EbsiExamSource["page"]>>> = [];
    let seen = 0;
    for (let page = 1; page <= 30; page += 1) {
      const parsed = await this.page({ ...input, page });
      out.push(parsed);
      seen += parsed.itemCount;
      if (
        parsed.itemCount === 0 ||
        parsed.itemCount < EBSI_STRUCTURE.pageSize ||
        seen >= parsed.total
      )
        break;
    }
    return out;
  }

  /**
   * 시험 identity discovery는 영어 영역만 조회한다.
   * 같은 시험이 세부과목마다 반복되는 EBSi 구조에서 불필요한 페이지 요청을 크게 줄인다.
   */
  private async listing(grade: Grade, year: number): Promise<DiscoveredExam[]> {
    const pages = await this.pages({ grade, year, areaOrders: ["3"] });
    const byIdentity = new Map<string, DiscoveredExam>();
    for (const page of pages) {
      for (const exam of page.exams) {
        const key = canonicalKey(exam.canonical);
        const existing = byIdentity.get(key);
        if (!existing || exam.examDate) byIdentity.set(key, exam);
      }
    }
    return [...byIdentity.values()].filter((e) => e.canonical.year === year);
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
   * 한 시험의 month만 조회하고 pagination을 모두 따라가 세부과목 전체를 모은다.
   * EBSi 공개 HTML의 onclick 인자만 파싱하며 다운로드 카운트/login endpoint는 호출하지 않는다.
   */
  async discoverArtifacts(exam: ExamLocator): Promise<DiscoveredArtifact[]> {
    const pages = await this.pages({
      grade: exam.grade,
      year: exam.year,
      month: exam.month,
      areaOrders: EBSI_AREA_ORDERS,
    });
    const wantedKey = canonicalKey(exam);
    const artifacts: DiscoveredArtifact[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const matchingIds = page.exams
        .filter(
          (e) =>
            (exam.externalId ? e.externalId === exam.externalId : true) &&
            canonicalKey(e.canonical) === wantedKey &&
            e.canonical.examType === exam.examType,
        )
        .map((e) => e.externalId);
      for (const id of matchingIds) {
        for (const artifact of page.artifactsByExternalId.get(id) ?? []) {
          const key = `${artifact.subject}:${
            artifact.course.status === "resolved" ? artifact.course.code : artifact.courseLabel ?? "-"
          }:${artifact.type}:${artifact.url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          artifacts.push(artifact);
        }
      }
    }
    return artifacts;
  }

  async healthCheck(): Promise<SourceHealth> {
    const checkedAt = this.now().toISOString();
    if (!this.source.enabled)
      return { status: "disabled", checkedAt, message: "source disabled" };
    try {
      const exams = await this.listing(3, this.now().getFullYear());
      return { status: "healthy", checkedAt, message: `parsed ${exams.length} exams via AJAX` };
    } catch (error) {
      const e = toIngestionError(error);
      return { status: healthStatusForError(e), checkedAt, message: `${e.code}: ${e.message}` };
    }
  }
}
