import { describe, expect, it } from "vitest";
import { absoluteGradeCuts, gradingMode } from "../../src/lib/grade-cut-mode";
import { estimateGrade } from "../../src/lib/grade-cuts";
import type { GradingRegime } from "../../src/lib/grade-cut-mode";

const current: GradingRegime = { year: 2026, grade: 3, examType: "kice_mock", academicYear: 2027 };

describe("exam-specific grading mode", () => {
  it("only relative subjects need watch states and external estimates", () => {
    expect(["korean", "math", "social", "science"].map((subject) =>
      gradingMode(current, subject as "korean"))).toEqual(["relative", "relative", "relative", "relative"]);
    expect(gradingMode(current, "english")).toBe("absolute");
    expect(gradingMode(current, "history")).toBe("absolute");
    expect(gradingMode(current, "second_language")).toBe("absolute");
  });
  it("uses each absolute subject's fixed raw-score boundaries, including ninth grade", () => {
    const english = absoluteGradeCuts(current, "english")!;
    const history = absoluteGradeCuts(current, "history")!;
    const language = absoluteGradeCuts(current, "second_language")!;
    expect([english.maxScore, history.maxScore, language.maxScore]).toEqual([100, 50, 50]);
    expect([english.cuts[0]!.rawScore, history.cuts[0]!.rawScore, language.cuts[0]!.rawScore]).toEqual([90, 40, 45]);
    expect(estimateGrade(english.cuts, 89)?.grade).toBe(2);
    expect(estimateGrade(history.cuts, 39)?.grade).toBe(2);
    expect(estimateGrade(language.cuts, 9)?.grade).toBeNull();
  });
  it("does not apply the 2022 foreign-language regime to an older CSAT", () => {
    expect(gradingMode({ ...current, year: 2020, academicYear: 2021, examType: "csat" }, "second_language")).toBe("relative");
    expect(gradingMode({ ...current, year: 2020, academicYear: 2021, examType: "school_mock" }, "second_language")).toBe("unknown");
  });
});
