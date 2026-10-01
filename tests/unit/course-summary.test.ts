import { describe, expect, it } from "vitest";
import { buildCourseSummaries, courseAvailability } from "../../src/lib/course-summary";
import type { Course } from "../../src/lib/data/types";

const course = (id: string, code: string, name: string): Course => ({
  id,
  code,
  name,
  subject: "math",
  displayOrder: 0,
});

const courses = [
  course("c-calc", "calculus", "미적분"),
  course("c-stat", "probability", "확률과 통계"),
  course("c-geo", "geometry", "기하"),
];

describe("course summaries for parent subject pages", () => {
  const summaries = buildCourseSummaries(courses, {
    files: [
      { courseId: "c-calc", type: "question", n: 1 },
      { courseId: "c-calc", type: "solution", n: 1 },
      { courseId: null, type: "question", n: 1 },
    ],
    processing: [
      { courseId: "c-calc", type: "question" },
      { courseId: "c-stat", type: "solution" },
    ],
    gradeCuts: [
      { courseId: "c-calc", source: "jongro", providerStatus: "provider_final", isOfficial: false },
      {
        courseId: "c-calc",
        source: "megastudy",
        providerStatus: "provider_estimate",
        isOfficial: false,
      },
      {
        courseId: null,
        source: "megastudy",
        providerStatus: "provider_estimate",
        isOfficial: false,
      },
    ],
    questions: [{ courseId: "c-calc", n: 8 }],
  });
  const [calc, stat, geo] = summaries;

  it("counts only the course's own rows (area-wide rows are not attributed to a course)", () => {
    expect(calc!.fileCount).toBe(2);
    expect(calc!.fileTypes.sort()).toEqual(["question", "solution"]);
    expect(calc!.gradeCuts.map((g) => g.source)).toEqual(["jongro", "megastudy"]);
    expect(calc!.questionCount).toBe(8);
  });

  it("drops processing types that are already published", () => {
    expect(calc!.processingTypes).toEqual([]);
    expect(stat!.processingTypes).toEqual(["solution"]);
  });

  it("distinguishes available / processing / truly empty", () => {
    expect(courseAvailability(calc!)).toBe("available");
    expect(courseAvailability(stat!)).toBe("processing");
    expect(courseAvailability(geo!)).toBe("empty");
  });

  it("never marks provider_final grade cuts as official", () => {
    expect(calc!.gradeCuts.every((g) => g.isOfficial === false)).toBe(true);
  });
});
