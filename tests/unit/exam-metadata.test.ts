import { describe, expect, it } from "vitest";
import { sampleDataset } from "@/lib/data/sample-data";
import { shouldNoindexExam } from "@/lib/exam-metadata";

describe("shouldNoindexExam (sample data SEO policy)", () => {
  const sample = sampleDataset.exams[0]!;
  const real = { ...sample, isSample: false };

  it("noindexes sample exams in production by default", () => {
    expect(shouldNoindexExam(sample, { NODE_ENV: "production" })).toBe(true);
  });
  it("only an explicit ALLOW_SAMPLE_INDEXING=1 lifts it", () => {
    expect(shouldNoindexExam(sample, { NODE_ENV: "production", ALLOW_SAMPLE_INDEXING: "1" })).toBe(
      false,
    );
    expect(
      shouldNoindexExam(sample, { NODE_ENV: "production", ALLOW_SAMPLE_INDEXING: "true" }),
    ).toBe(true);
  });
  it("real (non-sample) exams are always indexable", () => {
    expect(shouldNoindexExam(real, { NODE_ENV: "production" })).toBe(false);
  });
});
