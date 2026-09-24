import { describe, expect, it } from "vitest";
import { examPath, examTitle, parseExamParams } from "@/lib/exam-path";

describe("exam path", () => {
  it("builds SEO paths", () => {
    expect(examPath({ year: 2025, grade: 2, month: 9 })).toBe("/exam/2025/high2/09");
    expect(examPath({ year: 2024, grade: 3, month: 6 }, "english")).toBe(
      "/exam/2024/high3/06/english",
    );
    expect(examPath({ year: 2024, grade: 3, month: 6 }, "korean")).toBe("/exam/2024/high3/06");
  });

  it("parses route params", () => {
    expect(parseExamParams({ year: "2025", grade: "high2", month: "09" })).toEqual({
      year: 2025,
      grade: 2,
      month: 9,
    });
    expect(parseExamParams({ year: "2025", grade: "high4", month: "09" })).toBeNull();
    expect(parseExamParams({ year: "abcd", grade: "high2", month: "09" })).toBeNull();
    expect(parseExamParams({ year: "2025", grade: "high2", month: "13" })).toBeNull();
  });

  it("formats title", () => {
    expect(examTitle({ year: 2025, grade: 2, month: 9 })).toBe("2025년 고2 9월 모의고사");
  });
});
