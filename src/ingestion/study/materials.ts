import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  examFiles,
  exams,
  listeningTracks,
  listeningTranscripts,
  questions,
  studyMaterials,
  vocabulary,
} from "../../db/schema";
import { WORKSHEET_FILE_TYPES, type WorksheetFileType } from "../../lib/constants";
import type { Grade } from "../../lib/constants";
import { examPath } from "../../lib/exam-path";
import { canTransition, isPublishableTranscript, type StudyMaterialStatus } from "../../lib/study";
import type { IngestionContext } from "../context";
import { IngestionError } from "../errors";
import { enqueueJob } from "../jobs/queue";
import { examFileConflict } from "../pipeline/slots";
import { renderWorksheetPdf } from "./worksheet-pdf";
import { worksheetSpecs, type WorksheetInput } from "./worksheet-spec";

type Ctx = Pick<IngestionContext, "db" | "storage" | "revalidator" | "now" | "logger">;

/** 학습지 입력: DB 에 실제로 있는 단어장 · 공개 가능한 대본 · 웹 정답 */
export async function loadWorksheetInput(
  db: IngestionContext["db"],
  examId: string,
): Promise<WorksheetInput | null> {
  const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
  if (!exam) return null;
  const [words, tracks, qs] = await Promise.all([
    db
      .select({
        questionNumber: vocabulary.questionNumber,
        word: vocabulary.word,
        meaning: vocabulary.meaning,
        partOfSpeech: vocabulary.partOfSpeech,
      })
      .from(vocabulary)
      .where(and(eq(vocabulary.examId, examId), eq(vocabulary.subject, "english")))
      .orderBy(asc(vocabulary.questionNumber), asc(vocabulary.word)),
    db
      .select({
        questionNumber: listeningTracks.questionNumber,
        lines: listeningTranscripts.lines,
        origin: listeningTranscripts.origin,
      })
      .from(listeningTranscripts)
      .innerJoin(listeningTracks, eq(listeningTracks.id, listeningTranscripts.trackId))
      .where(eq(listeningTracks.examId, examId)),
    db
      .select({ questionNumber: questions.questionNumber, score: questions.score })
      .from(questions)
      .where(
        and(
          eq(questions.examId, examId),
          eq(questions.subject, "english"),
          isNull(questions.courseId),
        ),
      )
      .orderBy(asc(questions.questionNumber)),
  ]);
  return {
    exam: { year: exam.year, grade: exam.grade, month: exam.month },
    vocabulary: words,
    transcripts: tracks
      .filter((t) => t.questionNumber !== null && isPublishableTranscript(t.origin))
      .map((t) => ({ questionNumber: t.questionNumber!, lines: t.lines })),
    questions: qs,
  };
}

export async function enqueueStudyMaterials(ctx: Pick<Ctx, "db" | "now">, examId: string) {
  const input = await loadWorksheetInput(ctx.db, examId);
  if (!input) return;
  const specs = worksheetSpecs(input);
  if (specs.length === 0) return;
  const version = createHash("sha256")
    .update(specs.map((s) => s.fingerprint).join(","))
    .digest("hex")
    .slice(0, 16);
  await enqueueJob(ctx.db, {
    runAt: ctx.now(),
    type: "generate_study_materials",
    payload: { examId },
    dedupeKey: `study:${examId}:${version}`,
    maxAttempts: 3,
  });
}

/**
 * 학습지 PDF 생성 → study_materials(status=generated). 게시하지 않는다 (관리자 승인 후 게시).
 * 입력이 바뀌지 않은 학습지는 다시 만들지 않는다 (반려된 같은 내용도 다시 올리지 않는다).
 */
export async function generateStudyMaterials(ctx: Ctx, examId: string) {
  const input = await loadWorksheetInput(ctx.db, examId);
  if (!input) throw new IngestionError("EXAM_NOT_FOUND", examId);
  const specs = worksheetSpecs(input);
  const existing = await ctx.db
    .select()
    .from(studyMaterials)
    .where(and(eq(studyMaterials.examId, examId), eq(studyMaterials.subject, "english")));
  const { year, grade, month } = input.exam;
  let created = 0;
  for (const spec of specs) {
    const current = existing.find((m) => m.kind === spec.type && m.slotKey === "");
    if (current && current.inputFingerprint === spec.fingerprint) continue;
    const bytes = await renderWorksheetPdf(spec);
    const sha = createHash("sha256").update(bytes).digest("hex");
    // 생성 자료는 원본(exams/…)과 분리된 prefix 에 둔다
    const key = `generated/exams/${year}/high${grade}/${String(month).padStart(2, "0")}/english/${spec.type}-${sha.slice(0, 16)}.pdf`;
    await ctx.storage.putObject({ key, body: bytes, contentType: "application/pdf", sha256: sha });
    const values = {
      examId,
      subject: "english" as const,
      kind: spec.type,
      slotKey: "",
      questionNumber: null,
      origin: "generated" as const,
      status: "generated" as const,
      title: spec.title,
      content: {},
      sourceRefs: [{ kind: "worksheet_input", url: null, fileId: null }],
      inputFingerprint: spec.fingerprint,
      storageKey: key,
      mimeType: "application/pdf",
      fileSize: bytes.byteLength,
      sha256: sha,
      fileName: spec.fileName,
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: ctx.now(),
    };
    await ctx.db
      .insert(studyMaterials)
      .values(values)
      .onConflictDoUpdate({
        target: [
          studyMaterials.examId,
          studyMaterials.subject,
          studyMaterials.kind,
          studyMaterials.slotKey,
        ],
        // 이미 게시된 이전 버전(exam_file_id)은 새 버전이 승인·게시될 때까지 그대로 둔다
        set: values,
      });
    created += 1;
  }
  ctx.logger.info("study.materials_generated", { examId, specs: specs.length, created });
  return { specs: specs.length, created };
}

export type StudyReviewAction = "approve" | "publish" | "reject" | "start_review";

const ACTION_TARGET: Record<StudyReviewAction, StudyMaterialStatus> = {
  start_review: "reviewing",
  approve: "approved",
  publish: "published",
  reject: "rejected",
};

const isWorksheet = (kind: string): kind is WorksheetFileType =>
  (WORKSHEET_FILE_TYPES as readonly string[]).includes(kind);

/**
 * 관리자 검토. 게시는 승인된 자료만 가능하다.
 * 학습지 게시 = exam_files(artifact_origin=generated) 등록. 공식·수동 파일 슬롯은 덮어쓰지 않는다.
 */
export async function reviewStudyMaterial(
  ctx: Ctx,
  input: { id: string; action: StudyReviewAction; admin: string; note?: string | null },
) {
  const [m] = await ctx.db.select().from(studyMaterials).where(eq(studyMaterials.id, input.id));
  if (!m) throw new IngestionError("NOT_FOUND", "study material not found");
  const to = ACTION_TARGET[input.action];
  const from = m.status as StudyMaterialStatus;
  if (!canTransition(from, to))
    throw new IngestionError("INVALID_TRANSITION", `${from} → ${to} 는 허용되지 않습니다`);
  const [exam] = await ctx.db.select().from(exams).where(eq(exams.id, m.examId));
  if (!exam) throw new IngestionError("EXAM_NOT_FOUND", m.examId);
  const now = ctx.now();
  const englishPath = examPath(
    { year: exam.year, grade: exam.grade as Grade, month: exam.month },
    "english",
  );

  let examFileId = m.examFileId;
  if (to === "published" && isWorksheet(m.kind)) {
    if (!m.storageKey) throw new IngestionError("NO_FILE", "생성된 파일이 없습니다");
    const [slot] = await ctx.db
      .select()
      .from(examFiles)
      .where(
        and(
          eq(examFiles.examId, m.examId),
          eq(examFiles.subject, "english"),
          eq(examFiles.type, m.kind),
          isNull(examFiles.courseId),
        ),
      );
    if (slot && slot.artifactOrigin !== "generated")
      throw new IngestionError("SLOT_OCCUPIED", "공식/수동 파일이 있는 슬롯은 덮어쓰지 않습니다");
    const values = {
      examId: m.examId,
      subject: "english" as const,
      type: m.kind,
      deliveryType: "storage" as const,
      storageKey: m.storageKey,
      externalUrl: null,
      artifactOrigin: "generated" as const,
      sourceArtifactId: null,
      sourceLabel: "모의고사 창고",
      mimeType: m.mimeType ?? "application/pdf",
      fileSize: m.fileSize,
      originalFileName: m.fileName ?? `${m.kind}.pdf`,
      updatedAt: now,
    };
    const [row] = await ctx.db
      .insert(examFiles)
      .values(values)
      .onConflictDoUpdate({ ...examFileConflict(null), set: values })
      .returning({ id: examFiles.id });
    examFileId = row?.id ?? null;
  }
  if (to === "rejected" && from === "published" && m.examFileId) {
    // 게시를 내린다 (우리가 만든 파일만)
    await ctx.db
      .delete(examFiles)
      .where(and(eq(examFiles.id, m.examFileId), eq(examFiles.artifactOrigin, "generated")));
    examFileId = null;
  }

  await ctx.db
    .update(studyMaterials)
    .set({
      status: to,
      examFileId,
      reviewNote: input.note ?? m.reviewNote,
      reviewedBy: input.admin,
      reviewedAt: now,
      publishedAt: to === "published" ? now : m.publishedAt,
      updatedAt: now,
    })
    .where(eq(studyMaterials.id, m.id));
  ctx.logger.info("study.material_reviewed", { id: m.id, kind: m.kind, from, to });
  // 화면에 보이는 상태가 바뀌는 경우만 해당 시험 영어 페이지를 다시 만든다 (전체 purge 없음)
  if (to === "published" || from === "published" || to === "approved" || to === "rejected")
    await ctx.revalidator.revalidatePaths([englishPath]);
  return { from, to };
}

/** 관리자 목록 (검토 대기 우선) */
export async function listStudyMaterials(
  db: IngestionContext["db"],
  statuses: StudyMaterialStatus[] = ["generated", "reviewing", "approved"],
) {
  return db
    .select({ material: studyMaterials, exam: exams })
    .from(studyMaterials)
    .innerJoin(exams, eq(exams.id, studyMaterials.examId))
    .where(inArray(studyMaterials.status, statuses))
    .orderBy(asc(studyMaterials.updatedAt))
    .limit(200);
}
