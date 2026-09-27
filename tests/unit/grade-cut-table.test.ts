import { describe, expect, it } from "vitest";
import type { GradeCut } from "../../src/lib/data/types";
import {
  gradeCutTableColumns,
  gradeCutTableGrades,
  gradeCutValue,
} from "../../src/lib/grade-cut-table";

const row = (source: GradeCut["source"], cuts: GradeCut["cuts"], isOfficial = false): GradeCut => ({
  id: source,
  examId: "2026-g1-september",
  subject: "korean",
  courseId: null,
  source,
  sourceUrl: null,
  isOfficial,
  isSample: false,
  cuts,
  updatedAt: "2026-09-02T10:00:00.000Z",
});

describe("relative grade-cut table model", () => {
  it("keeps the official and enabled Mega columns and all nine grades when empty", () => {
    expect(gradeCutTableColumns([])).toEqual(["official", "megastudy"]);
    expect(gradeCutTableGrades()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(gradeCutValue([], "official", 1)).toBeNull();
    expect(gradeCutValue([], "megastudy", 9)).toBeNull();
  });

  it("shows Mega values without inventing official values or zeroes", () => {
    const cuts = [
      row("megastudy", [
        { grade: 1, rawScore: 87 },
        { grade: 2, rawScore: 77 },
      ]),
    ];
    expect(gradeCutValue(cuts, "official", 1)).toBeNull();
    expect(gradeCutValue(cuts, "megastudy", 1)).toBe(87);
    expect(gradeCutValue(cuts, "megastudy", 2)).toBe(77);
    expect(gradeCutValue(cuts, "megastudy", 3)).toBeNull();
  });

  it("retains official and Mega values independently", () => {
    const cuts = [
      row("official", [{ grade: 1, rawScore: 86 }], true),
      row("megastudy", [{ grade: 1, rawScore: 87 }]),
    ];
    expect(gradeCutTableColumns(cuts)).toEqual(["official", "megastudy"]);
    expect(gradeCutValue(cuts, "official", 1)).toBe(86);
    expect(gradeCutValue(cuts, "megastudy", 1)).toBe(87);
  });
});
