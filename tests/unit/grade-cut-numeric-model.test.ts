import { describe, expect, it } from "vitest";
import { cutsFingerprint, normalizeCuts } from "../../src/ingestion/grade-cuts/core";

describe("grade cut numeric models", () => {
  it("preserves decimal raw scores without rounding", () => {
    expect(normalizeCuts([{ grade: 1, rawScore: 43.5 }])).toEqual([{ grade: 1, rawScore: 43.5 }]);
  });

  it("preserves raw score ranges and does not replace them with a midpoint", () => {
    const cut = normalizeCuts([{ grade: 1, rawScoreMin: 88, rawScoreMax: 89 }])[0];
    expect(cut).toMatchObject({ rawScoreMin: 88, rawScoreMax: 89 });
    expect(cut?.rawScore).toBeUndefined();
  });

  it("accepts a standard-score-only boundary and validates its scale", () => {
    expect(normalizeCuts([{ grade: 1, standardScore: 130 }])[0]?.standardScore).toBe(130);
    expect(() => normalizeCuts([{ grade: 1, standardScore: 301 }])).toThrow();
  });

  it("fingerprints decimal, range, standard and percentile values", () => {
    const decimal = cutsFingerprint([{ grade: 1, rawScore: 43.5 }]);
    const range = cutsFingerprint([{ grade: 1, rawScoreMin: 42, rawScoreMax: 43 }]);
    const standard = cutsFingerprint([{ grade: 1, standardScore: 130 }]);
    const percentile = cutsFingerprint([{ grade: 1, percentile: 99 }]);
    expect(new Set([decimal, range, standard, percentile]).size).toBe(4);
  });

  it("rejects empty, invalid range, malformed text and non-monotonic cuts", () => {
    expect(() => normalizeCuts([])).toThrow();
    expect(() => normalizeCuts([{ grade: 1, rawScoreMin: 90, rawScoreMax: 89 }])).toThrow();
    expect(() => normalizeCuts([{ grade: 1, rawScoreText: "한국사 템플릿" }])).toThrow();
    expect(() =>
      normalizeCuts([
        { grade: 1, rawScore: 80 },
        { grade: 2, rawScore: 81 },
      ]),
    ).toThrow();
  });
});
