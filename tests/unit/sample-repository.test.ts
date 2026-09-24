import { describe, expect, it } from "vitest";
import { sampleDataset } from "@/lib/data/sample-data";
import { SampleExamRepository } from "@/lib/data/sample-repository";

describe("sample dataset", () => {
  it("marks every exam, statistic and grade cut as sample", () => {
    expect(sampleDataset.exams.every((e) => e.isSample)).toBe(true);
    expect(sampleDataset.statistics.every((s) => s.isSample)).toBe(true);
    expect(sampleDataset.gradeCuts.every((g) => g.isSample)).toBe(true);
  });

  it("has no duplicate year/grade/month exams or file slots", () => {
    const keys = sampleDataset.exams.map((e) => `${e.year}-${e.grade}-${e.month}`);
    expect(new Set(keys).size).toBe(keys.length);
    // 슬롯 = 시험 + 영역 + 세부과목(없으면 null) + 종류
    const slots = sampleDataset.files.map((f) => `${f.examId}-${f.subject}-${f.courseId}-${f.type}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("answer distributions sum to 100", () => {
    for (const s of sampleDataset.statistics) {
      if (s.answerDistribution) {
        expect(s.answerDistribution.reduce((a, b) => a + b, 0)).toBe(100);
      }
    }
  });

  it("subject scores add up to total", () => {
    const featured = sampleDataset.exams.find((e) => e.id === "exam_2025_h2_09")!;
    for (const subject of sampleDataset.examSubjects.filter((s) => s.examId === featured.id)) {
      // 영역 공통(세부과목 없음) 문항의 배점 합
      const total = sampleDataset.questions
        .filter((q) => q.examId === featured.id && q.subject === subject.subject && q.courseId === null)
        .reduce((sum, q) => sum + q.score, 0);
      expect(total).toBe(subject.totalScore);
    }
    // 세부과목 문항은 과목별로 따로 50점
    const socialCulture = sampleDataset.questions.filter((q) => q.courseId === "social-culture");
    expect(socialCulture.reduce((sum, q) => sum + q.score, 0)).toBe(50);
    {
    }
  });
});

describe("SampleExamRepository", () => {
  const repo = new SampleExamRepository();

  it("returns english detail with vocabulary and listening", async () => {
    const detail = await repo.getSubjectDetail({ year: 2025, grade: 2, month: 9 }, "english");
    expect(detail?.questions).toHaveLength(45);
    expect(detail?.vocabulary.length).toBeGreaterThan(0);
    expect(detail?.listeningTracks[0]?.questionNumber).toBeNull();
    expect(detail?.files.map((f) => f.type)).toContain("listening_audio");
  });

  it("returns null for missing exam", async () => {
    expect(await repo.getSubjectDetail({ year: 2030, grade: 2, month: 9 }, "math")).toBeNull();
  });

  it("stores reports and counts them by ip hash", async () => {
    await repo.createReport({
      examId: "exam_2025_h2_09",
      fileId: null,
      subject: "math",
      category: "wrong_answer",
      message: null,
      ipHash: "abc",
    });
    expect(await repo.countRecentReports("abc", new Date(Date.now() - 60_000))).toBe(1);
  });
});
