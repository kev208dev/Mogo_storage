import { and, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { examSchedules, exams } from "../../db/schema";
import { CORE_SUBJECTS, EXAM_TYPES } from "../../lib/constants";
import { ensureExamSubjects, organizerFor, upsertCanonicalExam } from "../pipeline/exams";

/**
 * 일정 입력 형식 (data/schedules/*.json). 공식 발표로 확인된 일정만 넣는다.
 * announcementUrl 에 근거 공지를 남긴다.
 */
export const scheduleInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  month: z.number().int().min(1).max(12),
  examType: z.enum(EXAM_TYPES),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  organizer: z.string().min(1).optional(),
  expectedReleaseStart: z.string().datetime({ offset: true }).optional(),
  expectedReleaseEnd: z.string().datetime({ offset: true }).optional(),
  announcementUrl: z.string().url().optional(),
  /**
   * 공식 공지에서 확인한 시험별 source 페이지 (예: KICE 시험별 자료 index).
   * URL 규칙을 추측하지 않기 위해 운영자가 명시적으로 등록한다. host 는 source allowlist 로 다시 검사된다.
   */
  sourcePages: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        url: z.string().url(),
        pageType: z.enum(["exam_release_index", "exam_detail", "listening_archive"]),
      }),
    )
    .optional(),
});
export const scheduleFileSchema = z.object({ schedules: z.array(scheduleInputSchema) });
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/**
 * 일정 등록 (idempotent). 시험 페이지를 미리 만들 수 있도록 Exam 도 함께 만든다.
 * 이미 있는 일정은 날짜/예상 공개 시각만 갱신한다.
 */
export async function upsertSchedule(db: Database, input: ScheduleInput) {
  if (input.examDate.slice(0, 4) !== String(input.year)) {
    throw new Error(`examDate ${input.examDate} does not match year ${input.year}`);
  }
  const canonical = {
    year: input.year,
    grade: input.grade,
    month: input.month,
    examType: input.examType,
    academicYear: input.examType === "school_mock" ? null : input.year + 1,
  };
  const exam = await upsertCanonicalExam(db, canonical, { examDate: input.examDate });
  await ensureExamSubjects(db, exam.examId, [...CORE_SUBJECTS]);
  const values = {
    year: input.year,
    grade: input.grade,
    month: input.month,
    examType: input.examType,
    organizer: input.organizer ?? organizerFor(canonical),
    examDate: input.examDate,
    expectedReleaseStart: input.expectedReleaseStart ? new Date(input.expectedReleaseStart) : null,
    expectedReleaseEnd: input.expectedReleaseEnd ? new Date(input.expectedReleaseEnd) : null,
    announcementUrl: input.announcementUrl ?? null,
    sourcePages: input.sourcePages ?? [],
    examId: exam.examId,
  };
  const [row] = await db
    .insert(examSchedules)
    .values(values)
    .onConflictDoUpdate({
      target: [
        examSchedules.year,
        examSchedules.grade,
        examSchedules.month,
        examSchedules.examType,
      ],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  await db.update(exams).set({ examDate: input.examDate }).where(eq(exams.id, exam.examId));
  return row!;
}

export type ScheduleRow = typeof examSchedules.$inferSelect;

/** release watch 대상 후보: 시험일이 지났거나 오늘인, 아직 끝나지 않은 일정 */
export async function loadWatchableSchedules(db: Database, now: Date): Promise<ScheduleRow[]> {
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return db
    .select()
    .from(examSchedules)
    .where(
      and(
        inArray(examSchedules.status, ["scheduled", "watching", "published"]),
        lte(examSchedules.examDate, today),
        eq(examSchedules.isSample, false),
      ),
    );
}
