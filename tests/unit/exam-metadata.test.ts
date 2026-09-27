import { describe, expect, it } from "vitest";
import { sampleDataset } from "@/lib/data/sample-data";
import { buildExamMetadata, buildExamStructuredData, shouldNoindexExam } from "@/lib/exam-metadata";

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

describe("exam long-tail SEO", () => {
  const exam = sampleDataset.exams.find((e) => e.year === 2025 && e.grade === 2 && e.month === 9)!;
  const subjects = sampleDataset.examSubjects.filter((row) => row.examId === exam.id);

  it("includes subject, problems, answers, explanations, and grade cuts in the title", () => {
    const metadata = buildExamMetadata(exam, subjects, "english");
    expect(metadata.title).toBe(
      "2025년 고2 9월 모의고사 영어 문제·정답·해설·등급컷",
    );
    expect(metadata.alternates?.canonical).toBe("/exam/2025/high2/09/english");
    expect(metadata.description).toContain("듣기 MP3");
    expect(metadata.description).toContain("자동 채점");
  });

  it("emits a canonical CollectionPage JSON-LD for exam detail pages", () => {
    const data = buildExamStructuredData(exam, subjects, "english");
    expect(data["@type"]).toBe("CollectionPage");
    expect(data.name).toBe("2025년 고2 9월 모의고사 영어 문제·정답·해설·등급컷");
    expect(data.url).toMatch(/\/exam\/2025\/high2\/09\/english$/);
    expect(data.inLanguage).toBe("ko-KR");
    expect(data.isPartOf).toMatchObject({ "@type": "WebSite", name: "모고창고" });
    expect(data.about).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "2025년 고2 9월 모의고사" }),
        expect.objectContaining({ name: "영어" }),
      ]),
    );
  });
});
