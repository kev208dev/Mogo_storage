import { and, eq } from "drizzle-orm";
import {
  examFiles,
  exams,
  reports,
  sourceArtifacts,
  sourceExams,
  vocabulary,
  vocabularyCandidates,
} from "../db/schema";
import type { ReportStatus } from "../lib/constants";
import type { IngestionContext } from "./context";
import { IngestionError } from "./errors";
import { enqueuePublish } from "./jobs/handlers";
import { enqueueVocabularyPdf } from "./jobs/vocabulary-handlers";
import { retryFailedJob } from "./jobs/queue";
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
  await ctx.db
    .update(sourceArtifacts)
    .set({ status: "ready", statusReason: "approved by admin", updatedAt: ctx.now() })
    .where(eq(sourceArtifacts.id, artifactId));
  await enqueuePublish(
    ctx,
    { examId: a.examId, subject: a.subject, type: a.type },
    `${a.id}:${a.sha256 ?? "none"}:approved`,
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
        { examId: mapping.examId, subject: a.subject, type: a.type },
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
