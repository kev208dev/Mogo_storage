import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { WatchExam } from "../../src/ingestion/grade-cuts/core";
import { parseJongroResultCut } from "../../src/ingestion/grade-cuts/adapters/jongro";

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

describe("Jongro grade-cut parser fixtures", () => {
  it("parses high school 1 raw, decimal, standard, percentile and integrated course rows", () => {
    const result = parseJongroResultCut(fixture(1), exam(1), url(1));
    expect(result.isOfficial).toBe(false);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "korean",
          providerStatus: "provider_final",
          providerLabel: "종로 최종",
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

  it("parses high school 2 estimate rows and preserves 42.5 without a maximum row", () => {
    const result = parseJongroResultCut(fixture(2), exam(2), url(2));
    expect(result.isOfficial).toBe(false);
    expect(result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerStatus: "provider_estimate",
          providerLabel: "종로 예상",
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
