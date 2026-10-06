import { eq } from "drizzle-orm";
import { sourceArtifacts, vocabulary, vocabularyCandidates } from "../../db/schema";
import type { IngestionContext } from "../context";
import { ArtifactValidationError, toIngestionError } from "../errors";
import { validateArtifact } from "../verify/artifact-validator";
import { extractVocabularyCandidates } from "../vocabulary/candidates";
import { extractPdfText } from "../vocabulary/pdf-text";
import { enqueueStudyMaterials, generateStudyMaterials } from "../study/materials";
import { JobError } from "./handlers";
import { downloadEnglishStudyArtifact } from "../study/artifact-fetch";
import type { Job } from "./queue";

/** PROCESS: 영어 해설 PDF → 텍스트 → 단어 후보 → (신뢰도 높은 것만) Vocabulary */
export async function handleExtractVocabulary(ctx: IngestionContext, job: Job) {
  const artifactId = String(job.payload.artifactId);
  const { db, logger } = ctx;
  const { artifact, res, expected, operatorApproved } = await downloadEnglishStudyArtifact(
    ctx,
    artifactId,
  );
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
  if (operatorApproved && !artifact.sha256) {
    await db
      .update(sourceArtifacts)
      .set({ sha256: check.sha256, updatedAt: ctx.now() })
      .where(eq(sourceArtifacts.id, artifact.id));
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

/** 단어장이 바뀌면 학습지(단어장 PDF · 단어 시험)를 다시 만든다 — 게시는 관리자 승인 후 */
export async function enqueueVocabularyPdf(ctx: IngestionContext, examId: string) {
  await enqueueStudyMaterials(ctx, examId);
}

/**
 * 이전 job 종류(generate_vocabulary_pdf) 호환: 이미 쌓인 job 은 학습지 생성으로 처리한다.
 * 예전처럼 바로 게시하지 않는다 (study_materials 검토 → 게시).
 */
export async function handleGenerateVocabularyPdf(ctx: IngestionContext, job: Job) {
  await generateStudyMaterials(ctx, String(job.payload.examId));
}
