import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { compareSummary, validateFixture, type FixtureMeta } from "@/ingestion/fixtures/contract";
import {
  applyDiscoveredSchedules,
  type DiscoveredSchedule,
  type ExamScheduleSource,
} from "@/ingestion/schedule/schedule-source";
import {
  parseEbsiExamArtifacts,
  parseEbsiExamList,
  parseEbsiListing,
  parseEbsiLivePage,
} from "@/ingestion/sources/ebsi/parser";
import { ebsiListingUrl } from "@/ingestion/sources/ebsi/structure";
import { parseKiceExamIndex, parseReleaseTime } from "@/ingestion/sources/kice/index-parser";
import { parseListeningArchive } from "@/ingestion/sources/listening-parser";
import { SourceStructureChangedError } from "@/ingestion/errors";

const fixture = (...p: string[]) =>
  readFileSync(path.join(__dirname, "..", "fixtures", ...p), "utf8");
const KICE_INDEX_URL = "https://www.suneung.re.kr/exam/2026/index.html";

describe("EBSi: discovery 와 artifact discovery 분리 (synthetic)", () => {
  const url = ebsiListingUrl("https://www.ebsi.co.kr", 2, 2025);

  it("exam_list parser 는 시험 identity 만, 자료 URL 은 보지 않는다", () => {
    const { exams } = parseEbsiExamList(fixture("ebsi", "listing-high2-2025.html"), {
      pageUrl: url,
      grade: 2,
      year: 2025,
    });
    expect(exams.map((e) => e.externalId)).toEqual(["EBSI-2025-H2-09", "EBSI-2025-H2-06"]);
    expect(exams[0]).not.toHaveProperty("artifacts");
    expect(exams[0]!.metadata.artifactPageUrl).toBe(url);
  });

  it("artifact parser 는 externalId 로 해당 시험의 자료만", () => {
    const html = fixture("ebsi", "listing-high2-2025.html");
    const sep = parseEbsiExamArtifacts(html, {
      pageUrl: url,
      grade: 2,
      year: 2025,
      externalId: "EBSI-2025-H2-09",
    });
    const combined = parseEbsiListing(html, { pageUrl: url, grade: 2, year: 2025 });
    expect(sep.found).toBe(true);
    expect(sep.artifacts).toEqual(combined.exams[0]!.artifacts);
    expect(
      parseEbsiExamArtifacts(html, { pageUrl: url, grade: 2, year: 2025, externalId: "nope" })
        .found,
    ).toBe(false);
  });

  it("고3: 사회·과학·직업탐구·제2외국어/한문 세부과목과 원문 표기", () => {
    const g3 = ebsiListingUrl("https://www.ebsi.co.kr", 3, 2025);
    const { exams } = parseEbsiListing(fixture("ebsi", "listing-high3-2025-electives.html"), {
      pageUrl: g3,
      grade: 3,
      year: 2025,
    });
    const rows = exams[0]!.artifacts.map((a) => [
      a.subject,
      a.course.status === "resolved" ? a.course.code : a.course.status,
      a.type,
      a.sourceSubjectLabel,
    ]);
    expect(rows).toEqual([
      ["social", "social-culture", "question", "사회탐구"],
      ["social", "social-culture", "solution", "사회탐구"],
      ["science", "earth-science-1", "question", "과학탐구"],
      ["vocational", "successful-career-life", "question", "직업탐구"],
      ["second_language", "japanese-1", "question", "제2외국어/한문"],
      ["second_language", "japanese-1", "solution", "제2외국어/한문"],
      ["second_language", "classical-chinese-1", "question", "제2외국어/한문"],
    ]);
  });
});



describe("EBSi current live AJAX parser", () => {
  const url = ebsiListingUrl("https://www.ebsi.co.kr", 3, 2026);

  it("groups course rows by irecord and maps problem/solution/audio/script downloads", () => {
    const parsed = parseEbsiLivePage(fixture("ebsi", "live-ajax-2026-h3-09.html"), {
      pageUrl: url,
      grade: 3,
      year: 2026,
    });
    expect(parsed.total).toBe(2);
    expect(parsed.exams).toHaveLength(1);
    expect(parsed.exams[0]).toMatchObject({
      externalId: "202609023",
      examDate: "2026-09-02",
      canonical: { year: 2026, grade: 3, month: 9, examType: "kice_mock" },
    });
    const artifacts = parsed.artifactsByExternalId.get("202609023")!;
    expect(
      artifacts.map((a) => [
        a.subject,
        a.course.status === "resolved" ? a.course.code : null,
        a.type,
      ]),
    ).toEqual([
      ["english", null, "question"],
      ["english", null, "solution"],
      ["english", null, "listening_audio"],
      ["english", null, "listening_script"],
      ["science", "physics-1", "question"],
      ["science", "physics-1", "solution"],
    ]);
    expect(artifacts[0]!.url).toBe(
      "https://wdown.ebsi.co.kr/W61001/01exam/20260902/go3/eng_1_mun_TEST.pdf",
    );
  });
});

describe("KiceExamIndexParser (synthetic — 머리글 텍스트 기반)", () => {
  const parsed = () =>
    parseKiceExamIndex(fixture("kice", "exam-index-2026-csat.html"), {
      pageUrl: KICE_INDEX_URL,
      examDate: "2025-11-13",
    });

  it("시험명 → 시행 연도 identity", () => {
    expect(parsed().exam).toMatchObject({ year: 2025, month: 11, examType: "csat" });
  });

  it("열 역할을 머리글로 찾는다", () => {
    expect(parsed().columns).toMatchObject({
      period: "교시",
      area: "시험영역",
      releaseTime: "정답 공개시간",
      question: "문제",
      solution: "정답",
      listening_audio: "듣기평가",
      listening_script: "음성대본",
    });
  });

  it('링크가 있는 칸만 artifact ("-" 는 아직 공개 전)', () => {
    const rows = parsed().artifacts.map((a) => [
      a.subject,
      a.course.status === "resolved" ? a.course.code : null,
      a.type,
    ]);
    expect(rows).toEqual([
      ["korean", null, "question"],
      ["korean", null, "solution"],
      ["math", null, "question"],
      ["math", null, "solution"],
      ["english", null, "question"],
      ["english", null, "listening_audio"],
      ["english", null, "listening_script"],
      ["history", null, "question"],
      ["social", "social-culture", "question"],
      ["second_language", "japanese-1", "question"],
    ]);
    expect(parsed().artifacts[0]!.url).toBe("https://www.suneung.re.kr/files/2026/kor_q.pdf");
  });

  it("공개 시각은 표에 적힌 값 (시험마다 다름, 하드코딩 없음) + rowspan 적용", () => {
    const times = parsed().releaseTimes.map((t) => [t.sourceLabel, t.rawTime, t.officialReleaseAt]);
    expect(times).toEqual([
      ["국어", "10:56", "2025-11-13T01:56:00.000Z"],
      ["수학", "14:10", "2025-11-13T05:10:00.000Z"],
      ["영어", "17:04", "2025-11-13T08:04:00.000Z"],
      ["한국사", "20:15", "2025-11-13T11:15:00.000Z"],
      ["사회탐구 - 사회·문화", "20:15", "2025-11-13T11:15:00.000Z"],
      // 아직 링크가 없는 과목도 공개 예정 시각은 알 수 있다
      ["과학탐구 - 물리학Ⅰ", "20:15", "2025-11-13T11:15:00.000Z"],
      ["제2외국어/한문 - 일본어Ⅰ", "21:48", "2025-11-13T12:48:00.000Z"],
    ]);
    expect(parsed().releaseTimes[5]!.course).toMatchObject({ code: "physics-1" });
    expect(parsed().artifacts[0]!.officialReleaseAt).toBe("2025-11-13T01:56:00.000Z");
  });

  it("parseReleaseTime: 날짜 표기, 시험일 기본값, '다음 날' 은 추정하지 않음", () => {
    expect(parseReleaseTime("2025. 11. 14. 09:00", "2025-11-13")).toBe("2025-11-14T00:00:00.000Z");
    expect(parseReleaseTime("11. 14.(금) 09:00", "2025-11-13")).toBe("2025-11-14T00:00:00.000Z");
    expect(parseReleaseTime("17시 04분", "2025-11-13")).toBe("2025-11-13T08:04:00.000Z");
    expect(parseReleaseTime("다음 날 09:00", "2025-11-13")).toBeNull();
    expect(parseReleaseTime("10:56", null)).toBeNull();
    expect(parseReleaseTime("추후 공지", "2025-11-13")).toBeNull();
  });

  it("머리글을 찾지 못하면 SourceStructureChangedError (조용히 빈 결과 없음)", () => {
    expect(() =>
      parseKiceExamIndex("<table><tr><th>제목</th><th>날짜</th></tr></table>", {
        pageUrl: KICE_INDEX_URL,
      }),
    ).toThrow(SourceStructureChangedError);
  });
});

describe("영어 듣기 자료 페이지 (listening_archive, synthetic)", () => {
  it("MP3/대본만 수집, 문제·정답 PDF 는 본 시험 슬롯을 덮지 않도록 건너뛰고, ZIP 은 archive", () => {
    const r = parseListeningArchive(fixture("ebsi", "listening-2025-h3-03.html"), {
      pageUrl: "https://www.ebsi.co.kr/listen",
    });
    expect(r.exam).toMatchObject({ year: 2025, grade: 3, month: 3, examType: "school_mock" });
    expect(r.artifacts.map((a) => [a.type, a.containerType])).toEqual([
      ["listening_audio", "file"],
      ["listening_script", "file"],
      ["listening_audio", "archive"],
    ]);
    expect(r.warnings.filter((w) => w.code === "LISTENING_PDF_SKIPPED")).toHaveLength(2);
    expect(r.artifacts.every((a) => a.subject === "english")).toBe(true);
  });
});

describe("fixture contract: pageType · examIdentity · expected summary", () => {
  const base = (m: Partial<FixtureMeta>): FixtureMeta => ({
    source: "kice",
    pageType: "exam_release_index",
    url: KICE_INDEX_URL,
    capturedAt: "2026-09-24T00:00:00Z",
    sha256: "",
    examIdentity: { year: 2025, grade: 3, month: 11, examType: "csat" },
    context: { examDate: "2025-11-13" },
    expected: {
      examCount: 1,
      containsSubjects: ["english", "korean", "math", "second_language", "social"],
      minimumArtifactCount: 10,
      releaseTimeCount: 7,
    },
    expectedReviewed: true,
    ...m,
  });

  it("exam_release_index fixture 가 contract 와 기대 요약을 만족", () => {
    const r = validateFixture(fixture("kice", "exam-index-2026-csat.html"), base({}));
    expect(r.errors).toEqual([]);
    expect(r.summary).toMatchObject({ examCount: 1, artifactCount: 10, releaseTimeCount: 7 });
  });

  it("parse 는 성공해도 요약이 달라지면 '구조 변경 가능성' 으로 실패", () => {
    const r = validateFixture(
      fixture("kice", "exam-index-2026-csat.html"),
      base({ expected: { examCount: 1, containsSubjects: ["science"], releaseTimeCount: 9 } }),
    );
    expect(r.ok).toBe(false);
    expect(r.drift.join("\n")).toMatch(/구조 변경 가능성: 영역 "science"/);
    expect(r.drift.join("\n")).toMatch(/공개 시각 7개 \(기록 9\)/);
  });

  it("metadata 의 시험과 페이지의 시험이 다르면 실패", () => {
    const r = validateFixture(
      fixture("kice", "exam-index-2026-csat.html"),
      base({ examIdentity: { year: 2025, grade: 3, month: 9, examType: "kice_mock" } }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/page shows exam 2025-3-11/);
  });

  it("listening_archive fixture", () => {
    const r = validateFixture(fixture("ebsi", "listening-2025-h3-03.html"), {
      source: "ebsi",
      pageType: "listening_archive",
      url: "https://www.ebsi.co.kr/listen",
      capturedAt: "2026-09-24T00:00:00Z",
      sha256: "",
      examIdentity: { year: 2025, grade: 3, month: 3, examType: "school_mock" },
      expected: { examCount: 1, containsSubjects: ["english"], minimumArtifactCount: 3 },
    });
    expect(r.errors).toEqual([]);
  });

  it("schedule pageType 은 parser 가 없으므로 실패 (추측 구현 없음)", () => {
    const r = validateFixture("<html></html>", base({ pageType: "schedule" }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/no schedule parser/);
  });

  it("compareSummary: 빈 페이지 기대", () => {
    expect(
      compareSummary(
        { examCount: 2, subjects: [], courses: [], artifactCount: 0, releaseTimeCount: 0 },
        { empty: true },
      )[0],
    ).toMatch(/expected an empty page/);
  });
});

describe("schedule source gate", () => {
  const schedule: DiscoveredSchedule = {
    year: 2026,
    grade: 3,
    month: 9,
    examType: "kice_mock",
    examDate: "2026-09-03",
    sourceLabel: "test",
  };
  it("검증되지 않은 일정 source 는 DB 를 건드리지 않고 검토 대기로만 돌려준다", async () => {
    const unverified: ExamScheduleSource = {
      id: "ebsi_schedule",
      verified: false,
      discoverSchedules: async () => [schedule],
    };
    // db 를 쓰면 실패하도록 빈 객체
    const result = await applyDiscoveredSchedules(
      {} as Database,
      unverified,
      await unverified.discoverSchedules(2026),
    );
    expect(result).toEqual({ applied: 0, pendingReview: [schedule] });
  });
});
