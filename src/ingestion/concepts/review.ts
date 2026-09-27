import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { concepts, courses, exams, questionConcepts, questions } from "../../db/schema";
import { canonicalConceptName, CONCEPT_NAME_MAX, type ConceptStatus } from "../../lib/concepts";
import { conceptPath, examCoursePath, examPath } from "../../lib/exam-path";

export class ConceptReviewError extends Error {}

/** 문항 ↔ 개념 연결 승인/거절. 바뀐 화면 경로(재검증 대상)를 돌려준다 */
export async function reviewQuestionConcept(
  db: Database,
  input: {
    questionId: string;
    conceptId: string;
    decision: Exclude<ConceptStatus, "manual_review">;
    reviewer: string;
    now?: Date;
  },
): Promise<string[]> {
  const now = input.now ?? new Date();
  const [row] = await db
    .select({ question: questions, exam: exams, course: courses, concept: concepts })
    .from(questionConcepts)
    .innerJoin(questions, eq(questions.id, questionConcepts.questionId))
    .innerJoin(exams, eq(exams.id, questions.examId))
    .innerJoin(concepts, eq(concepts.id, questionConcepts.conceptId))
    .leftJoin(courses, eq(courses.id, questions.courseId))
    .where(
      and(
        eq(questionConcepts.questionId, input.questionId),
        eq(questionConcepts.conceptId, input.conceptId),
      ),
    )
    .limit(1);
  if (!row) throw new ConceptReviewError("연결을 찾을 수 없습니다.");
  await db
    .update(questionConcepts)
    .set({
      status: input.decision,
      reviewedAt: now,
      reviewedBy: input.reviewer,
      updatedAt: now,
    })
    .where(
      and(
        eq(questionConcepts.questionId, input.questionId),
        eq(questionConcepts.conceptId, input.conceptId),
      ),
    );
  const key = { year: row.exam.year, grade: row.exam.grade as 1 | 2 | 3, month: row.exam.month };
  const subject = row.question.subject;
  return [
    examPath(key, subject),
    ...(row.course ? [examCoursePath(key, subject, row.course.code)] : []),
    conceptPath(row.concept.subject, row.concept.slug),
  ];
}

/**
 * 개념 표기 수정. slug(주소)는 바꾸지 않는다 — 이미 공유된 링크와 중복 제거 키를 지킨다.
 * 해설지에 없는 뜻을 덧붙이지 않도록 길이만 제한하고 표기만 통일한다.
 */
export async function renameConcept(
  db: Database,
  conceptId: string,
  rawName: string,
): Promise<string[]> {
  const name = canonicalConceptName(rawName);
  if (name.length < 2 || name.length > CONCEPT_NAME_MAX)
    throw new ConceptReviewError(`개념 이름은 2~${CONCEPT_NAME_MAX}자여야 합니다.`);
  const [concept] = await db
    .update(concepts)
    .set({ name, updatedAt: new Date() })
    .where(eq(concepts.id, conceptId))
    .returning();
  if (!concept) throw new ConceptReviewError("개념을 찾을 수 없습니다.");
  const rows = await db
    .selectDistinct({ exam: exams, subject: questions.subject, courseCode: courses.code })
    .from(questionConcepts)
    .innerJoin(questions, eq(questions.id, questionConcepts.questionId))
    .innerJoin(exams, eq(exams.id, questions.examId))
    .leftJoin(courses, eq(courses.id, questions.courseId))
    .where(and(eq(questionConcepts.conceptId, conceptId), eq(questionConcepts.status, "approved")));
  const paths = new Set([conceptPath(concept.subject, concept.slug)]);
  for (const r of rows) {
    const key = { year: r.exam.year, grade: r.exam.grade as 1 | 2 | 3, month: r.exam.month };
    paths.add(examPath(key, r.subject));
    if (r.courseCode) paths.add(examCoursePath(key, r.subject, r.courseCode));
  }
  return [...paths];
}
