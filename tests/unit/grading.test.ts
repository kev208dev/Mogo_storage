import { describe, expect, it } from "vitest";
import { estimateGrade, gradeAnswers } from "@/lib/grading";

const questions = [
  { questionNumber: 1, answer: "3", score: 2 },
  { questionNumber: 2, answer: "5", score: 3 },
  { questionNumber: 3, answer: "12", score: 4 },
];

describe("gradeAnswers", () => {
  it("computes score, correct/wrong lists", () => {
    const r = gradeAnswers(questions, { 1: "3", 2: "1", 3: "012" });
    expect(r.rawScore).toBe(6);
    expect(r.totalScore).toBe(9);
    expect(r.correctCount).toBe(2);
    expect(r.wrongNumbers).toEqual([2]);
  });

  it("treats unanswered as wrong", () => {
    const r = gradeAnswers(questions, {});
    expect(r.rawScore).toBe(0);
    expect(r.unansweredCount).toBe(3);
    expect(r.wrongNumbers).toEqual([1, 2, 3]);
  });
});

describe("estimateGrade", () => {
  const cuts = [90, 80, 70].map((rawScore, i) => ({ grade: i + 1, rawScore }));
  it("maps raw score to grade", () => {
    expect(estimateGrade(95, cuts)).toBe(1);
    expect(estimateGrade(80, cuts)).toBe(2);
    expect(estimateGrade(10, cuts)).toBe(4);
  });
});
