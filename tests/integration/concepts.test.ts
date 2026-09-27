import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import {
  ConceptReviewError,
  renameConcept,
  reviewQuestionConcept,
} from "@/ingestion/concepts/review";
import { DrizzleExamRepository } from "@/lib/data/drizzle-repository";
import { resetDb, setupDb, TEST_DB_URL } from "./helpers";

describe.skipIf(!TEST_DB_URL)("개념 태그: 검토 → 공개 화면", () => {
  let db: Database;
  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
  });

  let q1: string;
  let q2: string;
  let conceptId: string;
  beforeEach(async () => {
    await resetDb(db);
    const [exam] = await db
      .insert(s.exams)
      .values({
        year: 2025,
        grade: 3,
        month: 6,
        examDate: "2025-06-04",
        academicYear: 2026,
        examType: "kice_mock",
        organizer: "한국교육과정평가원",
        slug: "2025-3-6-concepts-test",
        isSample: false,
      })
      .returning();
    await db.insert(s.examSubjects).values({
      examId: exam!.id,
      subject: "science",
      questionCount: 20,
      totalScore: 50,
    });
    await db.insert(s.examCourses).values({ examId: exam!.id, courseId: "chemistry-1" });
    const qs = await db
      .insert(s.questions)
      .values(
        [1, 2].map((n) => ({
          examId: exam!.id,
          subject: "science" as const,
          courseId: "chemistry-1",
          questionNumber: n,
          answer: "1",
          choiceCount: 5,
          score: 2,
        })),
      )
      .returning();
    q1 = qs[0]!.id;
    q2 = qs[1]!.id;
    const [c] = await db
      .insert(s.concepts)
      .values({ subject: "science", name: "탄소 화합물", slug: "탄소-화합물" })
      .returning();
    conceptId = c!.id;
    await db.insert(s.questionConcepts).values([
      {
        questionId: q1,
        conceptId,
        status: "approved",
        source: "solution_heading",
        confidence: 0.9,
        evidence: "1. 탄소 화합물 (해설지 2쪽)",
      },
      {
        questionId: q2,
        conceptId,
        status: "manual_review",
        source: "solution_heading",
        confidence: 0.6,
        reviewReason: "텍스트 층에서 번호 위치가 흩어진 머리말",
      },
    ]);
  });

  const repo = () => new DrizzleExamRepository(db);
  const detail = () =>
    repo().getSubjectDetail({ year: 2025, grade: 3, month: 6 }, "science", "chemistry-1");

  it("공개 화면에는 승인된 연결만", async () => {
    const d = await detail();
    expect(d!.conceptTags[q1]).toEqual([
      { subject: "science", name: "탄소 화합물", slug: "탄소-화합물" },
    ]);
    expect(d!.conceptTags[q2]).toBeUndefined();
    const page = await repo().getConcept("science", "탄소-화합물");
    expect(page!.questions.map((q) => q.questionNumber)).toEqual([1]);
    expect(page!.questions[0]).toMatchObject({
      courseCode: "chemistry-1",
      evidence: "1. 탄소 화합물 (해설지 2쪽)",
    });
    expect(await repo().getConcept("science", "없는-개념")).toBeNull();
  });

  it("승인 → 공개, 거절 → 숨김, 재검증 경로 반환", async () => {
    const paths = await reviewQuestionConcept(db, {
      questionId: q2,
      conceptId,
      decision: "approved",
      reviewer: "admin@example.com",
    });
    expect(paths).toContain("/exam/2025/high3/06/science/chemistry-1");
    expect(paths.some((p) => p.startsWith("/concepts/science/"))).toBe(true);
    expect(Object.keys((await detail())!.conceptTags)).toHaveLength(2);
    const [link] = await db
      .select()
      .from(s.questionConcepts)
      .where(eq(s.questionConcepts.questionId, q2));
    expect(link).toMatchObject({ status: "approved", reviewedBy: "admin@example.com" });

    await reviewQuestionConcept(db, {
      questionId: q1,
      conceptId,
      decision: "rejected",
      reviewer: "admin@example.com",
    });
    expect((await detail())!.conceptTags[q1]).toBeUndefined();
    await expect(
      reviewQuestionConcept(db, {
        questionId: "nope",
        conceptId,
        decision: "approved",
        reviewer: "x",
      }),
    ).rejects.toBeInstanceOf(ConceptReviewError);
  });

  it("이름 수정은 표기만 바꾸고 주소(slug)는 유지", async () => {
    await renameConcept(db, conceptId, "  탄소   화합물의 특징 ");
    const [c] = await db.select().from(s.concepts).where(eq(s.concepts.id, conceptId));
    expect(c).toMatchObject({ name: "탄소 화합물의 특징", slug: "탄소-화합물" });
    await expect(renameConcept(db, conceptId, "a")).rejects.toBeInstanceOf(ConceptReviewError);
  });
});
