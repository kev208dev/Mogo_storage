import { describe, expect, it } from "vitest";
import type { WatchExam, WatchSlot } from "../../src/ingestion/grade-cuts/core";
import { jongroAdapter } from "../../src/ingestion/grade-cuts/adapters/jongro";

/** 2026-10-20 전국연합학력평가 (고1·고2·고3) */
const october = (grade: 1 | 2 | 3): WatchExam => ({
  id: "exam-oct-" + grade,
  year: 2026,
  grade,
  month: 10,
  examDate: "2026-10-20",
  examType: "school_mock",
  academicYear: 2026 + (4 - grade),
});

const slot = (subject: WatchSlot["subject"], courseCode: string | null): WatchSlot => ({
  examId: "exam",
  subject,
  courseId: courseCode,
  courseCode,
  status: "watching",
  lastPolledAt: null,
});

// supports 는 GradeCutAdapter 에서 선택 항목이지만 Jongro 는 반드시 구현한다
const supports = (exam: WatchExam, s: WatchSlot) => {
  expect(jongroAdapter.supports).toBeTypeOf("function");
  return jongroAdapter.supports!(exam, s);
};

describe("Jongro adapter supports() matches watch slots by course code", () => {
  it("고3 국어·수학 선택과목 slot 을 지원한다 (code 로 매칭)", () => {
    const exam = october(3);
    for (const code of ["speech-and-writing", "language-and-media"])
      expect(supports(exam, slot("korean", code))).toBe(true);
    for (const code of ["calculus", "probability-and-statistics", "geometry"])
      expect(supports(exam, slot("math", code))).toBe(true);
  });

  it("고3 탐구 세부과목 slot 을 지원한다", () => {
    const exam = october(3);
    expect(supports(exam, slot("social", "social-culture"))).toBe(true);
    expect(supports(exam, slot("science", "earth-science-1"))).toBe(true);
  });

  it("고1·고2 통합사회·통합과학과 국어·수학 영역 전체 slot 을 지원한다", () => {
    for (const grade of [1, 2] as const) {
      const exam = october(grade);
      expect(supports(exam, slot("social", "integrated-social"))).toBe(true);
      expect(supports(exam, slot("science", "integrated-science"))).toBe(true);
      expect(supports(exam, slot("korean", null))).toBe(true);
      expect(supports(exam, slot("math", null))).toBe(true);
    }
  });

  it("체제에 없는 과목 · 다른 영역의 code · 절대평가 영역 · 고3 영역 전체 slot 은 지원하지 않는다", () => {
    const g3 = october(3);
    const g1 = october(1);
    // 고1 은 통합 과목 체제라 물리학Ⅰ 이 없다
    expect(supports(g1, slot("science", "physics-1"))).toBe(false);
    // code 는 맞지만 영역이 다르면 거절
    expect(supports(g3, slot("science", "social-culture"))).toBe(false);
    // 한글 표기는 code 가 아니다
    expect(supports(g3, slot("math", "미적분"))).toBe(false);
    expect(supports(g3, slot("social", null))).toBe(false);
    expect(supports(g3, slot("korean", null))).toBe(false);
    expect(supports(g3, slot("english", null))).toBe(false);
    expect(supports(g3, slot("history", null))).toBe(false);
  });
});
