import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SourceStructureChangedError } from "@/ingestion/errors";
import { parseBoardAttachments, parseBoardList } from "@/ingestion/sources/board/parser";
import { EDUCATION_OFFICE_DEFINITION } from "@/ingestion/sources/education-office/structure";
import { parseEbsiListing } from "@/ingestion/sources/ebsi/parser";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import { KICE_DEFINITION } from "@/ingestion/sources/kice/structure";

const fixture = (...p: string[]) =>
  readFileSync(path.join(__dirname, "..", "fixtures", ...p), "utf8");

const EBSI = "https://www.ebsi.co.kr";

describe("EBSi parser (synthetic fixtures)", () => {
  const pageUrl = ebsiListingUrl(EBSI, 2, 2025);

  it("builds the listing URL in one place", () => {
    expect(pageUrl).toBe(
      "https://www.ebsi.co.kr/ebs/xip/xipc/previousPaperList.ebs?targetCd=D200&year=2025",
    );
  });

  it("parses exams, subjects, artifact types and URLs", () => {
    const { exams, warnings } = parseEbsiListing(fixture("ebsi", "listing-high2-2025.html"), {
      pageUrl,
      grade: 2,
      year: 2025,
    });
    expect(exams.map((e) => e.externalId)).toEqual(["EBSI-2025-H2-09", "EBSI-2025-H2-06"]);
    const sep = exams[0]!;
    expect(sep.canonical).toEqual({
      year: 2025,
      grade: 2,
      month: 9,
      examType: "school_mock",
      academicYear: null,
    });
    expect(sep.examDate).toBe("2025-09-03");
    const english = sep.artifacts.filter((a) => a.subject === "english").map((a) => a.type);
    expect(english).toEqual(["question", "solution", "listening_audio", "listening_script"]);
    expect(sep.artifacts.find((a) => a.subject === "korean" && a.type === "question")?.url).toBe(
      "https://wdown.ebsi.co.kr/exam/20250903/go2/kor_q.pdf",
    );
    // 상대 경로 href 도 절대 URL 로
    expect(exams[1]!.artifacts[0]!.url).toBe(
      "https://www.ebsi.co.kr/ebs/down/20250604/go2/kor_q.pdf",
    );
    // 공지 글은 경고로만 남는다. 제2외국어는 이제 지원 영역 (second_language)
    expect(warnings.map((w) => w.code).sort()).toEqual(["UNRECOGNIZED_TITLE"]);
    const lang = sep.artifacts.filter((a) => a.subject === "second_language");
    expect(lang.length).toBeGreaterThan(0);
    expect(lang[0]!.sourceSubjectLabel).toBe("제2외국어");
  });

  it("table/div 기반 semantic fallback으로 시험과 자료를 파싱한다", () => {
    const semanticPage = ebsiListingUrl(EBSI, 3, 2025);
    const { exams } = parseEbsiListing(fixture("ebsi", "listing-semantic-table.html"), {
      pageUrl: semanticPage,
      grade: 3,
      year: 2025,
    });
    expect(exams.map((e) => e.externalId)).toEqual(["202509023", "202506043"]);
    expect(exams[0]!.canonical).toMatchObject({
      year: 2025,
      month: 9,
      grade: 3,
      examType: "kice_mock",
      academicYear: 2026,
    });
    expect(exams[0]!.examDate).toBe("2025-09-03");
    expect(exams[0]!.artifacts.map((a) => `${a.subject}:${a.type}`)).toEqual([
      "english:question",
      "english:solution",
    ]);
    expect(exams[1]!.artifacts[0]).toMatchObject({
      subject: "korean",
      type: "question",
      url: "https://wdown.ebsi.co.kr/exam/20250604/go3/kor_q.pdf",
    });
  });

  it("학년도 표기 시험을 시행 연도로 변환한다", () => {
    const { exams } = parseEbsiListing(fixture("ebsi", "listing-high3-2025.html"), {
      pageUrl,
      grade: 3,
      year: 2025,
    });
    expect(exams[0]!.canonical).toMatchObject({
      year: 2025,
      month: 6,
      examType: "kice_mock",
      academicYear: 2026,
    });
    expect(exams[1]!.canonical).toMatchObject({ year: 2025, month: 4, examType: "school_mock" });
  });

  it("빈 목록은 정상적인 빈 결과", () => {
    expect(
      parseEbsiListing(fixture("ebsi", "listing-empty.html"), { pageUrl, grade: 2, year: 2025 })
        .exams,
    ).toEqual([]);
  });

  it("서버 HTML에 검색 shell만 남으면 SourceStructureChangedError 로 실패한다", () => {
    expect(() =>
      parseEbsiListing(fixture("ebsi", "listing-structure-changed.html"), {
        pageUrl,
        grade: 2,
        year: 2025,
      }),
    ).toThrow(SourceStructureChangedError);
  });

  it("필수 field(시험명)가 사라지면 SourceStructureChangedError", () => {
    expect(() =>
      parseEbsiListing(fixture("ebsi", "listing-missing-title.html"), {
        pageUrl,
        grade: 2,
        year: 2025,
      }),
    ).toThrow(/exam title/);
  });
});

describe("KICE board parser (synthetic fixtures)", () => {
  const pageUrl = KICE_DEFINITION.listUrl("https://www.suneung.re.kr", 1);

  it("lists only exam posts and maps 학년도 to 시행 연도", () => {
    const { exams, skipped } = parseBoardList(
      fixture("kice", "list-page1.html"),
      KICE_DEFINITION.structure,
      { pageUrl },
    );
    expect(
      exams.map((e) => [e.externalId, e.canonical.year, e.canonical.month, e.canonical.examType]),
    ).toEqual([
      ["5102", 2025, 9, "kice_mock"],
      ["5101", 2025, 6, "kice_mock"],
      ["5001", 2024, 11, "csat"],
      ["4902", 2024, 9, "kice_mock"],
    ]);
    expect(skipped).toEqual(["기출문제 저작권 안내"]);
    expect(exams[0]!.sourceUrl).toContain("boardSeq=5102");
  });

  it("empty page", () => {
    expect(
      parseBoardList(fixture("kice", "list-page2.html"), KICE_DEFINITION.structure, { pageUrl })
        .isEmpty,
    ).toBe(true);
  });

  it("parses attachments into subject/type slots", () => {
    const artifacts = parseBoardAttachments(
      fixture("kice", "view-5102.html"),
      KICE_DEFINITION.structure,
      {
        pageUrl: "https://www.suneung.re.kr/boardCnts/view.do?boardSeq=5102",
      },
    );
    expect(artifacts.map((a) => `${a.subject}:${a.type}`)).toEqual([
      "korean:question",
      "korean:solution",
      "math:question",
      "math:solution",
      "english:question",
      "english:solution",
      "english:listening_audio",
      "english:listening_script",
      "history:question",
      // 제2외국어/한문 영역 전체 PDF: 영역은 인식하되 세부과목은 추정하지 않는다
      "second_language:question",
    ]);
    const lang = artifacts.find((a) => a.subject === "second_language")!;
    expect(lang.course.status).toBe("none");
    expect(artifacts[0]!.url).toBe("https://www.suneung.re.kr/boardCnts/fileDown.do?fileSeq=a1");
  });

  it("missing attachment container → SourceStructureChangedError", () => {
    expect(() =>
      parseBoardAttachments(
        "<html><body><p>파일 없음</p></body></html>",
        KICE_DEFINITION.structure,
        { pageUrl },
      ),
    ).toThrow(SourceStructureChangedError);
  });

  it("changed list markup → SourceStructureChangedError", () => {
    expect(() =>
      parseBoardList(fixture("ebsi", "listing-structure-changed.html"), KICE_DEFINITION.structure, {
        pageUrl,
      }),
    ).toThrow(SourceStructureChangedError);
  });
});

describe("Education office parser (synthetic fixtures)", () => {
  it("parses list and attachments", () => {
    const pageUrl = EDUCATION_OFFICE_DEFINITION.listUrl("https://www.sen.go.kr", 1);
    const { exams, skipped } = parseBoardList(
      fixture("education-office", "list-page1.html"),
      EDUCATION_OFFICE_DEFINITION.structure,
      { pageUrl },
    );
    expect(
      exams.map((e) => `${e.canonical.year}-${e.canonical.grade}-${e.canonical.month}`),
    ).toEqual(["2025-1-9", "2025-2-9"]);
    expect(skipped).toHaveLength(1);
    const artifacts = parseBoardAttachments(
      fixture("education-office", "view-7002.html"),
      EDUCATION_OFFICE_DEFINITION.structure,
      { pageUrl: exams[1]!.sourceUrl },
    );
    expect(artifacts.map((a) => `${a.subject}:${a.type}`)).toEqual([
      "korean:question",
      "korean:solution",
      "english:question",
      "english:listening_audio",
    ]);
  });
});
