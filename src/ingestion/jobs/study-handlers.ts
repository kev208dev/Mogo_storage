import { and, eq, isNull } from "drizzle-orm";
import {
  examFiles,
  exams,
  listeningTracks,
  listeningTranscripts,
  sourceArtifacts,
} from "../../db/schema";
import type { Grade } from "../../lib/constants";
import { examPath } from "../../lib/exam-path";
import type { IngestionContext } from "../context";
import { ArtifactValidationError, toIngestionError } from "../errors";
import {
  LISTENING_SCRIPT_PARSER_VERSION,
  parseListeningScript,
  validateListeningScript,
} from "../study/listening-script";
import { enqueueStudyMaterials, generateStudyMaterials } from "../study/materials";
import { validateArtifact } from "../verify/artifact-validator";
import { extractPdfText } from "../vocabulary/pdf-text";
import { downloadArtifactBytes, JobError } from "./handlers";
import { enqueueJob, type Job } from "./queue";

/** PROCESS: 학습지 생성 (게시는 관리자 승인 후) */
export async function handleGenerateStudyMaterials(ctx: IngestionContext, job: Job) {
  await generateStudyMaterials(ctx, String(job.payload.examId));
}

/**
 * 공식 듣기 대본이 게시되면 문항별 대본 추출을 예약한다.
 * operator_import 는 브라우저 승인된 direct-file 만 downloadArtifactBytes 의 별도 gate 를 통과한다.
 */
export async function maybeEnqueueListeningScript(ctx: IngestionContext, examId: string) {
  const [file] = await ctx.db
    .select({ sourceArtifactId: examFiles.sourceArtifactId })
    .from(examFiles)
    .where(
      and(
        eq(examFiles.examId, examId),
        eq(examFiles.subject, "english"),
        eq(examFiles.type, "listening_script"),
        isNull(examFiles.courseId),
      ),
    );
  if (!file?.sourceArtifactId) return;
  const [artifact] = await ctx.db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, file.sourceArtifactId));
  const version = artifact?.contentFingerprint ?? artifact?.sha256;
  if (!artifact || !version) return;
  if (artifact.containerType !== "file") return; // ZIP 등은 자동으로 풀지 않는다
  await enqueueJob(ctx.db, {
    runAt: ctx.now(),
    type: "extract_listening_script",
    payload: { artifactId: artifact.id },
    dedupeKey: `listening-script:${artifact.id}:${version}`,
    maxAttempts: 3,
  });
}

/**
 * PROCESS: 공식 듣기 대본 PDF → 문항별 대본 (origin=official).
 * 구간(start/end)은 만들지 않는다: 새 트랙은 timing_verified=false 로 두어 화면은 전체 음원만 재생한다.
 */
export async function handleExtractListeningScript(ctx: IngestionContext, job: Job) {
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
  if (artifact.sha256 && check.sha256 !== artifact.sha256)
    throw new JobError(
      "ARTIFACT_CHANGED",
      "artifact changed since verification; waiting for re-verify",
    );

  let text: string;
  try {
    text = await extractPdfText(res.bytes);
  } catch (error) {
    throw new JobError("PDF_TEXT_EXTRACTION_FAILED", toIngestionError(error).message);
  }
  const parsed = parseListeningScript(text);
  const valid = validateListeningScript(parsed);
  if (!valid.ok) {
    // 형식을 확신할 수 없으면 공개하지 않는다 (재시도해도 같으므로 retryable=false)
    logger.warn("listening_script.unrecognized", { artifactId, reason: valid.reason });
    throw new JobError("LISTENING_SCRIPT_UNRECOGNIZED", valid.reason);
  }

  const files = await db
    .select({ id: examFiles.id, type: examFiles.type })
    .from(examFiles)
    .where(
      and(
        eq(examFiles.examId, artifact.examId),
        eq(examFiles.subject, "english"),
        isNull(examFiles.courseId),
      ),
    );
  const audio = files.find((f) => f.type === "listening_audio");
  const script = files.find((f) => f.type === "listening_script");
  // 트랙은 음원 파일을 가리켜야 한다. 음원이 아직 게시되지 않았으면 나중에 다시 시도
  if (!audio) throw new JobError("AUDIO_NOT_PUBLISHED", "listening audio not published yet", true);

  const now = ctx.now();
  for (const q of parsed.questions) {
    const [track] = await db
      .insert(listeningTracks)
      .values({
        examId: artifact.examId,
        fileId: audio.id,
        questionNumber: q.questionNumber,
        label: `${q.questionNumber}번`,
        startSeconds: 0,
        endSeconds: 0,
        timingVerified: false,
      })
      // 이미 있는 트랙(검증된 구간 포함)은 그대로 둔다
      .onConflictDoUpdate({
        target: [listeningTracks.examId, listeningTracks.questionNumber],
        set: { fileId: audio.id },
      })
      .returning({ id: listeningTracks.id });
    if (!track) continue;
    const [existing] = await db
      .select({ origin: listeningTranscripts.origin })
      .from(listeningTranscripts)
      .where(eq(listeningTranscripts.trackId, track.id));
    // 이용 허락을 받은 대본 등 다른 출처는 덮어쓰지 않는다
    if (existing && existing.origin !== "official" && existing.origin !== "unverified") continue;
    const values = {
      trackId: track.id,
      lines: q.lines,
      origin: "official" as const,
      sourceUrl: artifact.sourceUrl,
      sourceFileId: script?.id ?? null,
      parserVersion: LISTENING_SCRIPT_PARSER_VERSION,
      verifiedBy: `parser:${LISTENING_SCRIPT_PARSER_VERSION}`,
      verifiedAt: now,
      updatedAt: now,
    };
    await db
      .insert(listeningTranscripts)
      .values(values)
      .onConflictDoUpdate({ target: listeningTranscripts.trackId, set: values });
  }
  logger.info("listening_script.extracted", {
    examId: artifact.examId,
    artifactId,
    questions: parsed.questions.length,
    warnings: parsed.warnings.length,
  });
  const [exam] = await db.select().from(exams).where(eq(exams.id, artifact.examId));
  if (exam)
    await ctx.revalidator.revalidatePaths([
      examPath({ year: exam.year, grade: exam.grade as Grade, month: exam.month }, "english"),
    ]);
  await enqueueStudyMaterials(ctx, artifact.examId);
}
