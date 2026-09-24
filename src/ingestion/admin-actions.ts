import { and, eq } from "drizzle-orm";
import {
  courses,
  examCourses,
  examFiles,
  exams,
  reports,
  sourceArtifacts,
  sourceExams,
  vocabulary,
  vocabularyCandidates,
} from "../db/schema";
import type { ReportStatus } from "../lib/constants";
import { regimeFor } from "../lib/regimes";
import type { IngestionContext } from "./context";
import { IngestionError } from "./errors";
import { enqueuePublish } from "./jobs/handlers";
import { enqueueVocabularyPdf } from "./jobs/vocabulary-handlers";
import { enqueueJob, retryFailedJob } from "./jobs/queue";
import { saveCourseAlias } from "./pipeline/course-aliases";
import { setSourceEnabled } from "./pipeline/sources";

/**
 * 운영자가 할 수 있는 작업 (업로드 없음). 모든 작업은 idempotent 하며
 * 실제 게시/재검증은 job queue 를 통해 일반 파이프라인과 같은 경로로 처리된다.
 */

/** manual_review 자료 승인 → 공개 */
export async function approveArtifact(ctx: IngestionContext, artifactId: string) {
  const [a] = await ctx.db.select().from(sourceArtifacts).where(eq(sourceArtifacts.id, artifactId));
  if (!a) throw new IngestionError("NOT_FOUND", "artifact not found");
  if (a.status !== "manual_review")
    throw new IngestionError("INVALID_STATE", `artifact is ${a.status}`);
  if (a.slotKey.startsWith("unresolved:")) {
    throw new IngestionError("COURSE_UNRESOLVED", "세부과목을 먼저 지정해야 공개할 수 있습니다.");
  }
  if (a.containerType === "archive") {
    throw new IngestionError("ARCHIVE_NOT_SUPPORTED", "압축 파일은 아직 공개할 수 없습니다.");
  }
  if (!a.verifiedAt) throw new IngestionError("NOT_VERIFIED", "파일 검증이 끝나지 않았습니다.");
  await ctx.db
    .update(sourceArtifacts)
    .set({ status: "ready", statusReason: "approved by admin", updatedAt: ctx.now() })
    .where(eq(sourceArtifacts.id, artifactId));
  await enqueuePublish(
    ctx,
    { examId: a.examId, subject: a.subject, courseId: a.courseId, type: a.type },
    `${a.id}:${a.contentFingerprint ?? a.sha256 ?? "none"}:approved`,
  );
}

/** manual_review 자료 거절 (공개하지 않음) */
export async function rejectArtifact(ctx: IngestionContext, artifactId: string, reason: string) {
  await ctx.db
    .update(sourceArtifacts)
    .set({
      status: "unavailable",
      statusReason: `rejected by admin: ${reason}`.slice(0, 300),
      updatedAt: ctx.now(),
    })
    .where(and(eq(sourceArtifacts.id, artifactId), eq(sourceArtifacts.status, "manual_review")));
}

export { retryArtifact } from "./backfill";
export { retryFailedJob };

export async function toggleSource(ctx: IngestionContext, sourceId: string, enabled: boolean) {
  await setSourceEnabled(ctx.db, sourceId, enabled);
}

/**
 * 잘못된 source mapping 수정: source 시험을 다른 내부 Exam 으로 옮기고 고정(mappingLocked)한다.
 * 이 source 에서 발견된 자료와, 이 자료로 게시된 파일도 함께 옮긴다.
 */
export async function remapSourceExam(
  ctx: IngestionContext,
  sourceExamId: string,
  targetExamId: string,
) {
  await ctx.db.transaction(async (tx) => {
    const [mapping] = await tx.select().from(sourceExams).where(eq(sourceExams.id, sourceExamId));
    if (!mapping) throw new IngestionError("NOT_FOUND", "mapping not found");
    const [target] = await tx.select().from(exams).where(eq(exams.id, targetExamId));
    if (!target) throw new IngestionError("NOT_FOUND", "target exam not found");
    await tx
      .update(sourceExams)
      .set({ examId: targetExamId, mappingLocked: true })
      .where(eq(sourceExams.id, sourceExamId));
    const moved = await tx
      .select()
      .from(sourceArtifacts)
      .where(
        and(
          eq(sourceArtifacts.sourceId, mapping.sourceId),
          eq(sourceArtifacts.examId, mapping.examId),
        ),
      );
    for (const a of moved) {
      // 이전 시험에 게시된 파일은 내린다 (다른 source 후보가 있으면 publish job 이 다시 채운다)
      await tx.delete(examFiles).where(eq(examFiles.sourceArtifactId, a.id));
      await tx.delete(sourceArtifacts).where(eq(sourceArtifacts.id, a.id));
    }
    for (const a of moved) {
      await enqueuePublish(
        { ...ctx, db: tx as unknown as IngestionContext["db"] },
        { examId: mapping.examId, subject: a.subject, courseId: a.courseId, type: a.type },
        `remap:${a.id}`,
      );
    }
  });
  // 자료는 다음 discovery 에서 올바른 시험으로 다시 발견·검증된다
}

export async function setReportStatus(
  ctx: IngestionContext,
  reportId: string,
  status: ReportStatus,
) {
  await ctx.db.update(reports).set({ status }).where(eq(reports.id, reportId));
}

/** 단어 후보 검토: 승인하면 단어장에 추가되고 단어장 PDF 가 다시 생성된다 */
export async function reviewVocabularyCandidate(
  ctx: IngestionContext,
  candidateId: string,
  approve: boolean,
) {
  const [c] = await ctx.db
    .select()
    .from(vocabularyCandidates)
    .where(eq(vocabularyCandidates.id, candidateId));
  if (!c) throw new IngestionError("NOT_FOUND", "candidate not found");
  await ctx.db
    .update(vocabularyCandidates)
    .set({ status: approve ? "approved" : "rejected", updatedAt: ctx.now() })
    .where(eq(vocabularyCandidates.id, candidateId));
  if (approve && c.meaning) {
    await ctx.db
      .insert(vocabulary)
      .values({
        examId: c.examId,
        subject: "english",
        questionNumber: c.questionNumber,
        word: c.word,
        meaning: c.meaning,
        sourceArtifactId: c.sourceArtifactId,
      })
      .onConflictDoNothing();
    await enqueueVocabularyPdf(ctx, c.examId);
  }
}

/**
 * 자료의 세부과목 지정/수정 (예: source 가 "윤리" 로만 표기한 자료 → 생활과 윤리).
 *  - 원래 표기를 course_aliases 에 저장해 다음 수집부터 자동으로 같은 과목으로 판정한다 (기본: 해당 source 한정)
 *  - 이미 검증된 자료면 바로 게시, 아니면 검증 job 을 만든다
 *  - 다른 과목으로 잘못 게시돼 있었다면 그 게시를 내리고 원래 슬롯을 다른 source 로 다시 채운다
 */
export async function mapArtifactCourse(
  ctx: IngestionContext,
  input: {
    artifactId: string;
    courseCode: string;
    admin: string;
    aliasScope?: "source" | "global";
    /** true 면 이 시험의 체제(예: legacy)에서만 alias 를 적용 — 과거 표기를 현재 체제에 퍼뜨리지 않는다 */
    regimeOnly?: boolean;
  },
) {
  const [a] = await ctx.db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, input.artifactId));
  if (!a) throw new IngestionError("NOT_FOUND", "artifact not found");
  const [course] = await ctx.db.select().from(courses).where(eq(courses.code, input.courseCode));
  if (!course) throw new IngestionError("NOT_FOUND", `unknown course ${input.courseCode}`);
  if (course.subject !== a.subject) {
    throw new IngestionError(
      "SUBJECT_MISMATCH",
      `${course.name} 은(는) ${a.subject} 영역이 아닙니다.`,
    );
  }
  const [clash] = await ctx.db
    .select({ id: sourceArtifacts.id, sourceUrl: sourceArtifacts.sourceUrl })
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.sourceId, a.sourceId),
        eq(sourceArtifacts.examId, a.examId),
        eq(sourceArtifacts.subject, a.subject),
        eq(sourceArtifacts.type, a.type),
        eq(sourceArtifacts.slotKey, course.code),
      ),
    );
  if (clash && clash.id !== a.id) {
    throw new IngestionError(
      "SLOT_OCCUPIED",
      `이 source 에 이미 ${course.name} 자료가 있습니다. 중복 자료라면 거절 처리하세요.`,
    );
  }

  if (a.courseLabel) {
    const [exam] = input.regimeOnly
      ? await ctx.db.select().from(exams).where(eq(exams.id, a.examId))
      : [];
    await saveCourseAlias(ctx.db, {
      label: a.courseLabel,
      courseCode: course.code,
      sourceId: input.aliasScope === "global" ? null : a.sourceId,
      regimeCode: exam ? regimeFor(exam).code : null,
      createdBy: input.admin,
    });
  }
  const previousSlot = { examId: a.examId, subject: a.subject, courseId: a.courseId, type: a.type };
  const verified = Boolean(a.verifiedAt);
  const nextStatus = !verified
    ? "discovered"
    : a.deliveryPolicy === "manual_review"
      ? "manual_review"
      : "ready";
  await ctx.db
    .update(sourceArtifacts)
    .set({
      courseId: course.id,
      slotKey: course.code,
      status: nextStatus,
      statusReason: `course set to ${course.code} by ${input.admin}`,
      updatedAt: ctx.now(),
    })
    .where(eq(sourceArtifacts.id, a.id));
  await ctx.db
    .insert(examCourses)
    .values({ examId: a.examId, courseId: course.id })
    .onConflictDoNothing();

  // 다른 슬롯에 게시돼 있었다면 내리고, 원래 슬롯은 남은 후보로 다시 채운다
  if (a.courseId !== course.id) {
    const removed = await ctx.db
      .delete(examFiles)
      .where(eq(examFiles.sourceArtifactId, a.id))
      .returning({ id: examFiles.id });
    if (removed.length)
      await enqueuePublish(ctx, previousSlot, `unmap:${a.id}:${ctx.now().getTime()}`);
  }
  if (nextStatus === "ready") {
    await enqueuePublish(
      ctx,
      { examId: a.examId, subject: a.subject, courseId: course.id, type: a.type },
      `${a.id}:${a.contentFingerprint ?? a.sha256}:course:${course.code}`,
    );
  } else if (nextStatus === "discovered") {
    await enqueueJob(ctx.db, {
      runAt: ctx.now(),
      type: "verify_artifact",
      payload: { artifactId: a.id },
      dedupeKey: `verify:${a.id}:course:${course.code}:${ctx.now().getTime()}`,
    });
  }
  return { courseCode: course.code, status: nextStatus };
}
