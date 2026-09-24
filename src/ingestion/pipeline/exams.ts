import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { examSubjects, exams, sourceExams } from "../../db/schema";
import { EXAM_TYPE_LABELS, type Subject } from "../../lib/constants";
import { examSlug } from "../../lib/exam-path";
import { IngestionError } from "../errors";
import type { CanonicalExam, DiscoveredExam } from "../types";

type Tx = Pick<Database, "select" | "insert" | "update">;

export function organizerFor(exam: CanonicalExam): string {
  return exam.examType === "school_mock" ? "시·도 교육청" : "한국교육과정평가원";
}

export function examLabel(exam: { year: number; grade: number; month: number }): string {
  return `${exam.year} 고${exam.grade} ${exam.month}월`;
}

/**
 * canonical 시험 → 내부 Exam (없으면 생성). 같은 시험을 여러 source 가 발견해도 Exam 은 하나다.
 * year+grade+month 가 같은데 시험 종류가 다르면 잘못된 mapping 이므로 오류로 남긴다.
 */
export async function upsertCanonicalExam(
  db: Tx,
  canonical: CanonicalExam,
  extra: { examDate?: string | null } = {},
): Promise<{ examId: string; created: boolean; isSample: boolean }> {
  const inserted = await db
    .insert(exams)
    .values({
      year: canonical.year,
      grade: canonical.grade,
      month: canonical.month,
      academicYear: canonical.academicYear,
      examType: canonical.examType,
      organizer: organizerFor(canonical),
      examDate: extra.examDate ?? null,
      slug: examSlug(canonical),
      isSample: false,
    })
    .onConflictDoNothing({ target: [exams.year, exams.grade, exams.month] })
    .returning({ id: exams.id });
  if (inserted[0]) return { examId: inserted[0].id, created: true, isSample: false };

  const [existing] = await db
    .select()
    .from(exams)
    .where(
      and(
        eq(exams.year, canonical.year),
        eq(exams.grade, canonical.grade),
        eq(exams.month, canonical.month),
      ),
    );
  if (!existing)
    throw new IngestionError("EXAM_UPSERT_FAILED", "exam vanished during upsert", true);
  if (existing.examType !== canonical.examType) {
    throw new IngestionError(
      "EXAM_TYPE_CONFLICT",
      `${examLabel(canonical)}: existing ${EXAM_TYPE_LABELS[existing.examType]} vs discovered ${EXAM_TYPE_LABELS[canonical.examType]}`,
    );
  }
  // 비어 있는 정보만 채운다 (운영자가 고친 값은 유지)
  if (
    (!existing.examDate && extra.examDate) ||
    (existing.academicYear == null && canonical.academicYear)
  ) {
    await db
      .update(exams)
      .set({
        examDate: existing.examDate ?? extra.examDate ?? null,
        academicYear: existing.academicYear ?? canonical.academicYear,
        updatedAt: new Date(),
      })
      .where(eq(exams.id, existing.id));
  }
  return { examId: existing.id, created: false, isSample: existing.isSample };
}

export async function ensureExamSubjects(db: Tx, examId: string, subjects: Iterable<Subject>) {
  const list = [...new Set(subjects)];
  if (list.length === 0) return;
  await db
    .insert(examSubjects)
    .values(list.map((subject) => ({ examId, subject })))
    .onConflictDoNothing();
}

/**
 * source 시험 ↔ 내부 Exam mapping. (source, externalId) 당 1건.
 * 관리자가 고정(mappingLocked)한 mapping 은 자동 수집이 바꾸지 않는다.
 * 돌려주는 examId 는 실제로 사용할 mapping 대상이다.
 */
export async function upsertSourceExam(
  db: Tx,
  input: { sourceId: string; examId: string; discovered: DiscoveredExam; now: Date },
): Promise<{ examId: string; created: boolean }> {
  const { discovered, now } = input;
  const inserted = await db
    .insert(sourceExams)
    .values({
      sourceId: input.sourceId,
      examId: input.examId,
      externalId: discovered.externalId,
      sourceUrl: discovered.sourceUrl,
      sourceTitle: discovered.title,
      firstDiscoveredAt: now,
      lastSeenAt: now,
      metadata: discovered.metadata,
    })
    .onConflictDoUpdate({
      target: [sourceExams.sourceId, sourceExams.externalId],
      set: {
        lastSeenAt: now,
        sourceUrl: discovered.sourceUrl,
        sourceTitle: discovered.title,
        metadata: discovered.metadata,
        examId: sql`case when ${sourceExams.mappingLocked} then ${sourceExams.examId} else ${input.examId} end`,
      },
    })
    .returning({
      examId: sourceExams.examId,
      firstDiscoveredAt: sourceExams.firstDiscoveredAt,
    });
  const row = inserted[0]!;
  return { examId: row.examId, created: row.firstDiscoveredAt.getTime() === now.getTime() };
}
