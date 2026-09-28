import { describe, expect, it } from "vitest";
import { absoluteGradeCuts } from "../../src/lib/grade-cut-mode";
import type { GradeCut } from "../../src/lib/data/types";
import {
  gradeCutTableColumns,
  gradeCutTableGrades,
  gradeCutValue,
  gradeCutValueLabel,
  isOfficialGradeCutColumn,
} from "../../src/lib/grade-cut-table";

const current = { year: 2026, grade: 1, examType: "school_mock" as const, academicYear: 2027 };

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
    expect(gradeCutValueLabel([], "official", 1)).toBe("-");
    expect(gradeCutValueLabel([], "megastudy", 9)).toBe("-");
    expect(gradeCutValueLabel([], "official", 1)).not.toBe("0");
  });

  it("shows Mega values and expected status without inventing official values", () => {
    const cuts = [
      row("megastudy", [
        { grade: 1, rawScore: 87 },
        { grade: 2, rawScore: 77 },
      ]),
    ];
    expect(isOfficialGradeCutColumn("official")).toBe(true);
    expect(isOfficialGradeCutColumn("megastudy")).toBe(false);
    expect(gradeCutValue(cuts, "official", 1)).toBeNull();
    expect(gradeCutValueLabel(cuts, "official", 1)).toBe("-");
    expect(gradeCutValue(cuts, "megastudy", 1)).toBe(87);
    expect(gradeCutValueLabel(cuts, "megastudy", 1)).toBe("87");
    expect(gradeCutValue(cuts, "megastudy", 2)).toBe(77);
    expect(gradeCutValue(cuts, "megastudy", 3)).toBeNull();
    expect(gradeCutValueLabel(cuts, "megastudy", 3)).toBe("-");
  });

  it("renders range values without inventing a midpoint", () => {
    const cuts = [
      row("megastudy", [{ grade: 1, rawScore: null, rawScoreMin: 88, rawScoreMax: 90 }]),
    ];
    expect(gradeCutValue(cuts, "megastudy", 1)).toBeNull();
    expect(gradeCutValueLabel(cuts, "megastudy", 1)).toBe("88~90");
  });

  it("shows Jongro as a separate non-official provider and labels score units", () => {
    const jongro = {
      ...row("jongro", [{ grade: 1, rawScore: 43.5, standardScore: 130, percentile: 99 }]),
      providerStatus: "provider_final",
      providerLabel: "종로 최종",
    };
    expect(gradeCutTableColumns([jongro])).toEqual(["official", "megastudy", "jongro"]);
    expect(isOfficialGradeCutColumn("jongro")).toBe(false);
    expect(jongro.isOfficial).toBe(false);
    expect(gradeCutValueLabel([jongro], "jongro", 1)).toBe(
      "원점수 43.5 · 표준점수 130 · 백분위 99",
    );
  });

  it("retains official and Mega values independently with an official designation", () => {
    const cuts = [
      row("official", [{ grade: 1, rawScore: 86 }], true),
      row("megastudy", [{ grade: 1, rawScore: 87 }]),
    ];
    expect(gradeCutTableColumns(cuts)).toEqual(["official", "megastudy"]);
    expect(isOfficialGradeCutColumn("official")).toBe(true);
    expect(gradeCutValue(cuts, "official", 1)).toBe(86);
    expect(gradeCutValue(cuts, "megastudy", 1)).toBe(87);
  });

  it("leaves absolute subjects on their fixed-score boundaries", () => {
    const english = absoluteGradeCuts(current, "english")!;
    expect(english.maxScore).toBe(100);
    expect(english.cuts[0]).toEqual({ grade: 1, rawScore: 90 });
    expect(english.cuts[7]).toEqual({ grade: 8, rawScore: 20 });
  });
});
