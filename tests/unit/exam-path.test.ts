import { describe, expect, it } from "vitest";
import {
  examCoursePath,
  examPath,
  examTitle,
  legacySubjectSegmentRedirect,
  parseExamParams,
  parseSubjectSegment,
} from "@/lib/exam-path";

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

describe("제2외국어/한문 URL segment (DB enum 은 URL 이 아니다)", () => {
  const key = { year: 2025, grade: 3 as const, month: 7 };
  it("URL 은 second-language", () => {
    expect(examPath(key, "second_language")).toBe("/exam/2025/high3/07/second-language");
    expect(examCoursePath(key, "second_language", "japanese-1")).toBe(
      "/exam/2025/high3/07/second-language/japanese-1",
    );
  });
  it("segment 해석: second-language 만 인정, enum 표기는 redirect 대상", () => {
    expect(parseSubjectSegment("second-language")).toBe("second_language");
    expect(parseSubjectSegment("second_language")).toBeNull();
    expect(legacySubjectSegmentRedirect("second_language")).toBe("second-language");
    expect(legacySubjectSegmentRedirect("second-language")).toBeNull();
    expect(legacySubjectSegmentRedirect("english")).toBeNull();
    expect(legacySubjectSegmentRedirect("nope")).toBeNull();
  });
});
