import { describe, expect, it } from "vitest";
import { sampleDataset } from "@/lib/data/sample-data";
import { SITE_NAME } from "@/lib/constants";
import type { Course } from "@/lib/data/types";
import {
  buildExamMetadata,
  buildExamStructuredData,
  examSearchTitle,
  monthAlias,
  NO_FEATURES,
  shouldNoindexExam,
  type ExamSeoFeatures,
} from "@/lib/exam-metadata";

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
  const all: ExamSeoFeatures = {
    questionPaper: true,
    solution: true,
    answers: true,
    gradeCuts: true,
    listening: true,
    vocabulary: true,
  };

  it("title: 시험 · 3/6/9 약칭 · 과목 · 실제 제공 자료만", () => {
    const metadata = buildExamMetadata(exam, subjects, "english", { features: all });
    expect(metadata.title).toBe("2025년 고2 9월 모의고사(9모) 영어 문제·정답·해설·등급컷");
    expect(metadata.alternates?.canonical).toBe("/exam/2025/high2/09/english");
    expect(metadata.description).toContain("영어 듣기 MP3");
    expect(metadata.description).toContain("자동 채점");
    expect(metadata.description).toContain("지문별 단어장");
  });

  it("없는 기능은 title · description 에 넣지 않는다", () => {
    const metadata = buildExamMetadata(exam, subjects, "math", {
      features: { ...NO_FEATURES, questionPaper: true, solution: true },
    });
    expect(metadata.title).toBe("2025년 고2 9월 모의고사(9모) 수학 문제·정답·해설");
    expect(String(metadata.description)).not.toMatch(/등급컷|자동 채점|듣기|단어장/);
    expect(metadata.description).toContain("문제지와 정답·해설 PDF");

    const empty = buildExamMetadata(exam, subjects, "math", { features: NO_FEATURES });
    expect(empty.title).toBe("2025년 고2 9월 모의고사(9모) 수학");
    expect(String(empty.description)).toContain("공개되는 대로");
  });

  it("3·6·9월만 약칭, 다른 달은 만들지 않는다", () => {
    expect(monthAlias(3)).toBe("3모");
    expect(monthAlias(6)).toBe("6모");
    expect(monthAlias(9)).toBe("9모");
    for (const m of [1, 4, 5, 7, 10, 11, 12]) expect(monthAlias(m)).toBeNull();
    expect(examSearchTitle({ year: 2026, grade: 3, month: 11 })).toBe("2026년 고3 11월 모의고사");
  });

  it("세부과목: 카탈로그 약칭만 쓰고 URL 은 course code 그대로", () => {
    const course: Course = {
      id: "social-culture",
      code: "social-culture",
      name: "사회·문화",
      subject: "social",
      displayOrder: 90,
    };
    const metadata = buildExamMetadata(exam, subjects, "social", {
      course,
      features: { ...NO_FEATURES, questionPaper: true, solution: true },
    });
    expect(metadata.title).toBe("2025년 고2 9월 모의고사(9모) 사회문화 문제·정답·해설");
    expect(metadata.description).toContain("사회·문화(사문)");
    expect(metadata.alternates?.canonical).toBe("/exam/2025/high2/09/social/social-culture");
    const calculus = buildExamMetadata(exam, subjects, "math", {
      course: { ...course, id: "calculus", code: "calculus", name: "미적분", subject: "math" },
      features: NO_FEATURES,
    });
    // 미적분은 카탈로그에 약칭이 없다 → 만들지 않는다
    expect(calculus.description).toContain("수학 미적분 자료");
  });

  it("시험 첫 페이지: 과목 없이, OpenGraph siteName · locale", () => {
    const metadata = buildExamMetadata(exam, subjects, null, { features: all });
    expect(metadata.title).toBe("2025년 고2 9월 모의고사(9모) 문제·정답·해설·등급컷");
    expect(metadata.alternates?.canonical).toBe("/exam/2025/high2/09");
    expect(metadata.openGraph).toMatchObject({ siteName: SITE_NAME, locale: "ko_KR" });
  });

  it("emits a canonical CollectionPage JSON-LD for exam detail pages", () => {
    const data = buildExamStructuredData(exam, subjects, "english", { features: all });
    expect(data["@type"]).toBe("CollectionPage");
    expect(data.name).toBe("2025년 고2 9월 모의고사(9모) 영어 문제·정답·해설·등급컷");
    expect(data.url).toMatch(/^https?:\/\/[^/]+\/exam\/2025\/high2\/09\/english$/);
    expect(data.inLanguage).toBe("ko-KR");
    expect(data.isPartOf).toMatchObject({ "@type": "WebSite", name: SITE_NAME });
    expect(data.about).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "2025년 고2 9월 모의고사" }),
        expect.objectContaining({ name: "영어" }),
      ]),
    );
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
