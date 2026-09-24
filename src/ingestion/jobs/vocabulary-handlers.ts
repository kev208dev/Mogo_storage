import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { examFiles, exams, vocabulary, vocabularyCandidates } from "../../db/schema";
import type { IngestionContext } from "../context";
import { ArtifactValidationError, toIngestionError } from "../errors";
import { validateArtifact } from "../verify/artifact-validator";
import { extractVocabularyCandidates } from "../vocabulary/candidates";
import { generateVocabularyPdf } from "../vocabulary/pdf-generator";
import { extractPdfText } from "../vocabulary/pdf-text";
import { downloadArtifactBytes, JobError } from "./handlers";
import { enqueueJob, type Job } from "./queue";

/** PROCESS: 영어 해설 PDF → 텍스트 → 단어 후보 → (신뢰도 높은 것만) Vocabulary */
export async function handleExtractVocabulary(ctx: IngestionContext, job: Job) {
  const artifactId = String(job.payload.artifactId);
  const { db, logger } = ctx;
  const { artifact, res, expected } = await downloadArtifactBytes(ctx, artifactId);
  const check = validateArtifact({
    status: res.status,
    contentType: res.contentType,
    bytes: res.bytes,
    expected,
  });
  if (!check.ok) throw new ArtifactValidationError(check.code, check.message);
  if (artifact.sha256 && check.sha256 !== artifact.sha256) {
    throw new JobError(
      "ARTIFACT_CHANGED",
      "artifact changed since verification; waiting for re-verify",
    );
  }

  let text: string;
  try {
    text = await extractPdfText(res.bytes);
  } catch (error) {
    throw new JobError("PDF_TEXT_EXTRACTION_FAILED", toIngestionError(error).message);
  }
  const candidates = extractVocabularyCandidates(text);
  const now = ctx.now();
  for (const c of candidates) {
    await db
      .insert(vocabularyCandidates)
      .values({
        examId: artifact.examId,
        sourceArtifactId: artifact.id,
        questionNumber: c.questionNumber,
        word: c.word,
        meaning: c.meaning,
        confidence: c.confidence,
        status: c.status,
      })
      .onConflictDoNothing();
  }
  const approved = candidates.filter((c) => c.status === "auto_approved" && c.meaning);
  if (approved.length) {
    await db
      .insert(vocabulary)
      .values(
        approved.map((c) => ({
          examId: artifact.examId,
          subject: "english" as const,
          questionNumber: c.questionNumber,
          word: c.word,
          meaning: c.meaning!,
          sourceArtifactId: artifact.id,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
  }
  logger.info("vocabulary.extracted", {
    examId: artifact.examId,
    artifactId,
    candidates: candidates.length,
    autoApproved: approved.length,
    needsReview: candidates.length - approved.length,
  });
  if (approved.length) await enqueueVocabularyPdf(ctx, artifact.examId);
}

export async function enqueueVocabularyPdf(ctx: IngestionContext, examId: string) {
  const rows = await ctx.db
    .select({ n: vocabulary.questionNumber, w: vocabulary.word, m: vocabulary.meaning })
    .from(vocabulary)
    .where(and(eq(vocabulary.examId, examId), eq(vocabulary.subject, "english")));
  if (rows.length === 0) return;
  const version = createHash("sha256")
    .update(JSON.stringify(rows.sort((a, b) => a.n - b.n || a.w.localeCompare(b.w))))
    .digest("hex")
    .slice(0, 16);
  await enqueueJob(ctx.db, {
    runAt: ctx.now(),
    type: "generate_vocabulary_pdf",
    payload: { examId },
    dedupeKey: `vocab-pdf:${examId}:${version}`,
    maxAttempts: 3,
  });
}

/** PROCESS: Vocabulary → 우리가 만든 단어장 PDF (generated artifact) */
export async function handleGenerateVocabularyPdf(ctx: IngestionContext, job: Job) {
  const examId = String(job.payload.examId);
  const { db } = ctx;
  const [exam] = await db.select().from(exams).where(eq(exams.id, examId));
  if (!exam) throw new JobError("EXAM_NOT_FOUND", examId);
  const rows = await db
    .select()
    .from(vocabulary)
    .where(and(eq(vocabulary.examId, examId), eq(vocabulary.subject, "english")))
    .orderBy(asc(vocabulary.questionNumber), asc(vocabulary.word));
  if (rows.length === 0) return;

  const [current] = await db
    .select()
    .from(examFiles)
    .where(
      and(
        eq(examFiles.examId, examId),
        eq(examFiles.subject, "english"),
        eq(examFiles.type, "vocabulary_pdf"),
      ),
    );
  if (current && current.artifactOrigin !== "generated") {
    // 공식 단어장이나 수동 등록 파일은 덮어쓰지 않는다
    return;
  }

  const title = `${exam.year}년 고${exam.grade} ${exam.month}월 영어 지문별 단어장`;
  const bytes = await generateVocabularyPdf({
    title,
    entries: rows.map((r) => ({
      questionNumber: r.questionNumber,
      word: r.word,
      meaning: r.meaning,
      partOfSpeech: r.partOfSpeech,
    })),
    sourceNote:
      "모의고사 창고가 공식 해설 자료에서 추출한 단어로 만든 학습 자료입니다. 원본 시험 자료가 아닙니다.",
  });
  const sha = createHash("sha256").update(bytes).digest("hex");
  const key = `generated/${exam.slug}/english/vocabulary-${sha.slice(0, 16)}.pdf`;
  await ctx.storage.putObject({ key, body: bytes, contentType: "application/pdf", sha256: sha });

  const values = {
    examId,
    subject: "english" as const,
    type: "vocabulary_pdf" as const,
    deliveryType: "storage" as const,
    storageKey: key,
    externalUrl: null,
    artifactOrigin: "generated" as const,
    sourceArtifactId: null,
    sourceLabel: "모의고사 창고",
    mimeType: "application/pdf",
    fileSize: bytes.byteLength,
    originalFileName: `${title}.pdf`,
    updatedAt: ctx.now(),
  };
  await db
    .insert(examFiles)
    .values(values)
    .onConflictDoUpdate({
      target: [examFiles.examId, examFiles.subject, examFiles.type],
      set: values,
    });
  ctx.logger.info("vocabulary.pdf_generated", { examId, words: rows.length, storageKey: key });
  await ctx.revalidator.revalidatePaths([
    `/exam/${exam.year}/high${exam.grade}/${String(exam.month).padStart(2, "0")}/english`,
  ]);
}
