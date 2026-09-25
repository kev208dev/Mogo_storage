import type { ExamType, Subject } from "./constants";
import type { GradeCutEntry } from "./data/types";

export type GradingMode = "relative" | "absolute" | "unknown";
export interface GradingRegime {
  year: number;
  grade: number;
  examType: ExamType;
  academicYear: number | null;
}

/** Only confirmed relative slots are eligible for external grade-cut collection. */
export function gradingMode(exam: GradingRegime, subject: Subject): GradingMode {
  if (["korean", "math", "social", "science", "vocational"].includes(subject))
    return "relative";

  const academicYear = exam.academicYear ?? exam.year + 1;
  if (subject === "history")
    return exam.examType === "school_mock"
      ? exam.year >= 2016 ? "absolute" : "unknown"
      : academicYear >= 2017 ? "absolute" : "unknown";
  if (subject === "english")
    return exam.examType === "school_mock"
      ? exam.year >= 2017 ? "absolute" : "unknown"
      : academicYear >= 2018 ? "absolute" : "unknown";
  if (subject === "second_language") {
    if (exam.examType === "school_mock")
      return exam.grade === 3 && exam.year >= 2021 ? "absolute" : "unknown";
    return academicYear >= 2022 ? "absolute" : "relative";
  }
  return "unknown";
}

export function absoluteGradeCuts(exam: GradingRegime, subject: Subject):
  { cuts: GradeCutEntry[]; maxScore: number } | null {
  if (gradingMode(exam, subject) !== "absolute") return null;
  const scores = subject === "english"
    ? [90, 80, 70, 60, 50, 40, 30, 20]
    : subject === "history"
      ? [40, 35, 30, 25, 20, 15, 10, 5]
      : [45, 40, 35, 30, 25, 20, 15, 10];
  return {
    cuts: scores.map((rawScore, i) => ({ grade: i + 1, rawScore })),
    maxScore: subject === "english" ? 100 : 50,
  };
}
