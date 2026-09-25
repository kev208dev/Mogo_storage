import { describe, expect, it } from "vitest";
import {
  GradeCutInputError,
  parseGradeCutEntries,
  parseGradeCutSourceUrl,
} from "@/ingestion/grade-cuts/input";
import { estimateGrade } from "@/lib/grade-cuts";

describe("grade cut manual input", () => {
  it("parses common operator formats and sorts by grade", () => {
    expect(parseGradeCutEntries("3 72\n1: 88\n2,80")).toEqual([
      { grade: 1, rawScore: 88 },
      { grade: 2, rawScore: 80 },
      { grade: 3, rawScore: 72 },
    ]);
  });

  it("rejects duplicate, invalid and increasing cutoffs", () => {
    expect(() => parseGradeCutEntries("1: 88\n1: 80")).toThrow(GradeCutInputError);
    expect(() => parseGradeCutEntries("1: 101")).toThrow(GradeCutInputError);
    expect(() => parseGradeCutEntries("1: 80\n2: 85")).toThrow(GradeCutInputError);
  });

  it("accepts only safe HTTPS source links", () => {
    expect(parseGradeCutSourceUrl("https://example.com/cut")).toBe("https://example.com/cut");
    expect(() => parseGradeCutSourceUrl("http://example.com/cut")).toThrow(GradeCutInputError);
    expect(() => parseGradeCutSourceUrl("https://user:pass@example.com/cut")).toThrow(
      GradeCutInputError,
    );
  });
});

describe("grade estimate", () => {
  const cuts = [
    { grade: 1, rawScore: 88 },
    { grade: 2, rawScore: 80 },
    { grade: 3, rawScore: 72 },
  ];

  it("returns the first satisfied grade boundary", () => {
    expect(estimateGrade(cuts, 94)).toEqual({ grade: 1, label: "1등급" });
    expect(estimateGrade(cuts, 82)).toEqual({ grade: 2, label: "2등급" });
    expect(estimateGrade(cuts, 72)).toEqual({ grade: 3, label: "3등급" });
  });

  it("does not invent a grade below the lowest stored boundary", () => {
    expect(estimateGrade(cuts, 60)).toEqual({ grade: null, label: "3등급 컷 미만" });
  });
});
