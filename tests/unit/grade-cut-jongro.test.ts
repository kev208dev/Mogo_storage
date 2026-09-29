import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WatchExam } from "../../src/ingestion/grade-cuts/core";
import {
  jongroAdapter,
  parseJongroResultCut,
} from "../../src/ingestion/grade-cuts/adapters/jongro";

const exam = (grade: 1 | 2 | 3): WatchExam => ({
  id: "exam-" + grade,
  year: 2026,
  grade,
  month: 9,
  examDate: "2026-09-02",
  examType: "school_mock",
  academicYear: 2026 + (4 - grade),
});
const fixture = (grade: 1 | 2 | 3) =>
  readFileSync(
    new URL("../fixtures/grade-cuts/jongro/jongro-2026-09-g" + grade + ".html", import.meta.url),
    "utf8",
  );
const url = (grade: number) =>
  "https://www.jongro.co.kr/service/examResult/ex20260902/go" + grade + "_resultCut.asp";

const liveTable = (max: [number, number, number], first: [number, number, number]) => `
  <table class="view_data01">
    <caption>영역별 등급컷</caption>
    <tr><th><img alt="등급"></th><th><img alt="원점수"></th><th><img alt="표준점수"></th><th><img alt="백분위"></th></tr>
    <tr><td><img alt="0등급"></td><td>${max[0]}</td><td>${max[1]}</td><td>${max[2]}</td></tr>
    <tr><td><img alt="1등급"></td><td>${first[0]}</td><td>${first[1]}</td><td>${first[2]}</td></tr>
  </table>`;

const liveLayoutFixture = `
  <html><body>
    <h1>2026년 고1 9.2 확정 등급컷</h1>
    <p>표준점수를 토대로 원점수를 역산</p>
    <ul id="tabController01" class="mlist01 tab_subject01">
      <li><img alt="국어"></li><li><img alt="수학"></li><li><img alt="영어"></li><li><img alt="한국사"></li><li><img alt="탐구"></li>
    </ul>
    <div id="tabCon01"><ul class="mlist02 tab_subject02"><li><img alt="국어"></li></ul><div id="tabCon01_01">${liveTable([100, 149, 100], [87, 137, 96])}</div></div>
    <div id="tabCon02"><ul class="mlist02 tab_subject02"><li><img alt="수학"></li></ul><div id="tabCon02_01">${liveTable([100, 151, 100], [84, 137, 96])}</div></div>
    <div id="tabCon03"><ul class="mlist02 tab_subject02"><li><img alt="영어"></li></ul><div id="tabCon03_01">${liveTable([100, 0, 0], [90, 0, 0])}</div></div>
    <div id="tabCon05"><ul class="mlist02 tab_subject02"><li><img alt="한국사"></li></ul><div id="tabCon05_01">${liveTable([50, 0, 0], [40, 0, 0])}</div></div>
    <div id="tabCon06">
      <ul class="mlist02 tab_subject02"><li><img alt="사회탐구"></li><li><img alt="과학탐구"></li></ul>
      <div id="tabCon06_01">${liveTable([50, 70, 100], [43.5, 64, 96])}</div>
      <div id="tabCon06_02">${liveTable([50, 70, 99], [47, 68, 96])}</div>
    </div>
  </body></html>`;

describe("Jongro grade-cut parser fixtures", () => {
  it("parses high school 1 raw, decimal, standard, percentile and integrated course rows", () => {
    expect(jongroAdapter.source).toBe("jongro");
    const result = parseJongroResultCut(fixture(1), exam(1), url(1));
    expect(result.isOfficial).toBe(false);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "korean",
          providerStatus: "provider_final",
          providerLabel: "종로 최종",
          parserVersion: "jongro-result-cut-v1",
          observedVia: null,
          firstParty: true,
          scoreBasis: "standard",
          cuts: expect.arrayContaining([
            expect.objectContaining({ grade: 1, rawScore: 87, standardScore: 137, percentile: 96 }),
          ]),
        }),
        expect.objectContaining({
          subject: "social",
          courseCode: "integrated-social",
          cuts: expect.arrayContaining([expect.objectContaining({ rawScore: 43.5 })]),
        }),
        expect.objectContaining({ subject: "science", courseCode: "integrated-science" }),
      ]),
    );
  });

  it("parses the live id-based DOM layout and image-alt labels", () => {
    const result = parseJongroResultCut(liveLayoutFixture, exam(1), url(1));
    expect(result.rows).toHaveLength(4);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "korean",
          courseCode: null,
          cuts: expect.arrayContaining([
            expect.objectContaining({ grade: 1, rawScore: 87, standardScore: 137, percentile: 96 }),
          ]),
        }),
        expect.objectContaining({
          subject: "math",
          courseCode: null,
          cuts: expect.arrayContaining([expect.objectContaining({ grade: 1, rawScore: 84 })]),
        }),
        expect.objectContaining({
          subject: "social",
          courseCode: "integrated-social",
          cuts: expect.arrayContaining([expect.objectContaining({ grade: 1, rawScore: 43.5 })]),
        }),
        expect.objectContaining({
          subject: "science",
          courseCode: "integrated-science",
          cuts: expect.arrayContaining([expect.objectContaining({ grade: 1, rawScore: 47 })]),
        }),
      ]),
    );
    expect(result.rows.every((row) => row.cuts.every((cut) => cut.grade !== 0))).toBe(true);
    expect(result.rows.every((row) => row.providerStatus === "provider_final")).toBe(true);
  });

  it("parses high school 2 estimate rows and preserves 42.5 without a maximum row", () => {
    const result = parseJongroResultCut(fixture(2), exam(2), url(2));
    expect(result.isOfficial).toBe(false);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerStatus: "provider_estimate",
          providerLabel: "종로 예상",
          parserVersion: "jongro-result-cut-v1",
          subject: "social",
          courseCode: "integrated-social",
          cuts: expect.arrayContaining([expect.objectContaining({ rawScore: 42.5 })]),
        }),
      ]),
    );
  });

  it("maps high school 3 Korean/math electives and inquiry courses only through COURSE_CATALOG", () => {
    const result = parseJongroResultCut(fixture(3), exam(3), url(3));
    expect(result.rows.map((row) => row.courseCode)).toEqual(
      expect.arrayContaining([
        "language-and-media",
        "speech-and-writing",
        "calculus",
        "probability-and-statistics",
        "social-culture",
        "physics-1",
        "economics",
      ]),
    );
    expect(result.rows.some((row) => row.courseCode === "unknown-course")).toBe(false);
  });

  it("skips malformed table templates and absolute English/history rows", () => {
    const result = parseJongroResultCut(fixture(1), exam(1), url(1));
    expect(result.rows.every((row) => row.subject !== "english" && row.subject !== "history")).toBe(
      true,
    );
    expect(result.rows.some((row) => row.cuts.some((cut) => cut.grade === 0))).toBe(false);
  });

  it("rejects URL and page identity mismatches", () => {
    expect(() => parseJongroResultCut(fixture(1), exam(1), url(2))).toThrow(/identity/);
    expect(() =>
      parseJongroResultCut(fixture(1).replace("2026년 고1", "2025년 고1"), exam(1), url(1)),
    ).toThrow(/identity/);
  });
});
