import { and, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { examSchedules, exams } from "../../db/schema";
import { CORE_SUBJECTS, EXAM_TYPES } from "../../lib/constants";
import { isHostAllowed } from "../net/url-policy";
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
  /** 시행일 변경 사유 (공식 변경 공지 근거) */
  changeNote: z.string().trim().min(1).max(300).optional(),
  /** 시험 취소 (공식 공지로 확인된 경우만) */
  cancelled: z.boolean().optional(),
  cancelledReason: z.string().trim().min(1).max(300).optional(),
});
export const scheduleFileSchema = z.object({ schedules: z.array(scheduleInputSchema) });

/**
 * 일정 근거로 인정하는 공식 도메인 (시행 기관 · 교육부 · 교육청).
 * 학원·언론 기사는 근거로 받지 않는다 (날짜를 옮겨 적다 틀릴 수 있다).
 */
export const OFFICIAL_SCHEDULE_HOSTS = [".kice.re.kr", ".suneung.re.kr", ".go.kr"];

export function isOfficialAnnouncementUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && isHostAllowed(u.hostname, OFFICIAL_SCHEDULE_HOSTS);
  } catch {
    return false;
  }
}

/** 운영자 입력(파일·관리자 화면) 검사: 공식 공지 URL 필수, 취소는 사유 필수 */
export function validateManualSchedule(input: ScheduleInput): string[] {
  const errors: string[] = [];
  if (!input.announcementUrl) errors.push("announcementUrl (공식 공지 URL) 이 필요합니다");
  else if (!isOfficialAnnouncementUrl(input.announcementUrl))
    errors.push(`공식 도메인이 아닙니다: ${new URL(input.announcementUrl).hostname}`);
  if (input.examDate.slice(0, 4) !== String(input.year))
    errors.push(`examDate ${input.examDate} 가 year ${input.year} 와 다릅니다`);
  if (input.cancelled && !input.cancelledReason) errors.push("cancelledReason 이 필요합니다");
  return errors;
}

export type SchedulePlan =
  | { action: "create" }
  | { action: "unchanged" }
  | { action: "update"; changes: string[] }
  | { action: "conflict"; reason: string };

/** dry-run: 무엇이 바뀌는지 (DB 를 바꾸지 않는다) */
export async function planSchedule(db: Database, input: ScheduleInput): Promise<SchedulePlan> {
  const rows = await db
    .select()
    .from(examSchedules)
    .where(
      and(
        eq(examSchedules.year, input.year),
        eq(examSchedules.grade, input.grade),
        eq(examSchedules.month, input.month),
      ),
    );
  const other = rows.find((r) => r.examType !== input.examType && !r.isSample);
  if (other)
    return {
      action: "conflict",
      reason: `같은 학년·월에 다른 시험 유형(${other.examType}) 일정이 이미 있습니다`,
    };
  const current = rows.find((r) => r.examType === input.examType);
  if (!current) return { action: "create" };
  const changes: string[] = [];
  if (current.examDate !== input.examDate)
    changes.push(`examDate ${current.examDate} → ${input.examDate}`);
  if ((current.announcementUrl ?? null) !== (input.announcementUrl ?? null))
    changes.push("announcementUrl");
  if (Boolean(input.cancelled) !== (current.status === "cancelled"))
    changes.push(input.cancelled ? "cancelled" : "uncancelled");
  return changes.length ? { action: "update", changes } : { action: "unchanged" };
}
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

/**
 * 일정 등록 (idempotent). 시험 페이지를 미리 만들 수 있도록 Exam 도 함께 만든다.
 * 이미 있는 일정은 날짜/예상 공개 시각만 갱신한다.
 */
export async function upsertSchedule(
  db: Database,
  input: ScheduleInput,
  opts: { verifiedBy?: string; now?: Date } = {},
) {
  if (input.examDate.slice(0, 4) !== String(input.year)) {
    throw new Error(`examDate ${input.examDate} does not match year ${input.year}`);
  }
  if (input.announcementUrl && !isOfficialAnnouncementUrl(input.announcementUrl))
    throw new Error(`announcementUrl must be an official https URL: ${input.announcementUrl}`);
  const plan = await planSchedule(db, input);
  if (plan.action === "conflict") throw new Error(plan.reason);
  const [previous] = await db
    .select()
    .from(examSchedules)
    .where(
      and(
        eq(examSchedules.year, input.year),
        eq(examSchedules.grade, input.grade),
        eq(examSchedules.month, input.month),
        eq(examSchedules.examType, input.examType),
      ),
    );
  const dateChanged = previous && previous.examDate !== input.examDate;
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
    verifiedBy: opts.verifiedBy ?? previous?.verifiedBy ?? null,
    verifiedAt: opts.verifiedBy ? (opts.now ?? new Date()) : (previous?.verifiedAt ?? null),
    previousExamDate: dateChanged ? previous.examDate : (previous?.previousExamDate ?? null),
    changeNote: dateChanged ? (input.changeNote ?? null) : (previous?.changeNote ?? null),
    cancelledReason: input.cancelled ? (input.cancelledReason ?? null) : null,
    ...(input.cancelled
      ? { status: "cancelled" as const }
      : previous?.status === "cancelled"
        ? { status: "scheduled" as const }
        : {}),
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
  // 취소된 시험은 시행일을 비워 시험일 기준 작업(release watch · 등급컷 감시)이 돌지 않게 한다
  await db
    .update(exams)
    .set({ examDate: input.cancelled ? null : input.examDate })
    .where(eq(exams.id, exam.examId));
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
