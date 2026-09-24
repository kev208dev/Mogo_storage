import { and, eq, inArray } from "drizzle-orm";
import { examFiles, exams, examSchedules, ingestionErrors, sourceArtifacts } from "../../db/schema";
import type { FileType, Subject } from "../../lib/constants";
import type { IngestionContext } from "../context";
import { ArtifactValidationError, IngestionError, redactUrl, toIngestionError } from "../errors";
import { publishSlot } from "../pipeline/artifacts";
import { examLabel } from "../pipeline/exams";
import { loadSource } from "../pipeline/sources";
import { createFetcherFor } from "../sources/registry";
import {
  expectedKindFor,
  MAX_ARTIFACT_BYTES,
  validateArtifact,
} from "../verify/artifact-validator";
import { enqueueJob, type Job } from "./queue";

export class JobError extends IngestionError {}

async function loadArtifact(ctx: IngestionContext, artifactId: string) {
  const [artifact] = await ctx.db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, artifactId));
  if (!artifact) throw new JobError("ARTIFACT_NOT_FOUND", `artifact ${artifactId} not found`);
  const source = await loadSource(ctx.db, artifact.sourceId);
  if (!source) throw new JobError("SOURCE_NOT_FOUND", `source ${artifact.sourceId} not found`);
  return { artifact, source };
}

export async function downloadArtifactBytes(ctx: IngestionContext, artifactId: string) {
  const { artifact, source } = await loadArtifact(ctx, artifactId);
  const fetcher = createFetcherFor(source, ctx.adapterOptions);
  const expected = expectedKindFor(artifact.type);
  const res = await fetcher.fetch(artifact.sourceUrl, { maxBytes: MAX_ARTIFACT_BYTES[expected] });
  return { artifact, source, res, expected };
}

/**
 * VERIFY (+ MIRROR or REGISTER_URL):
 *  - 공식 URL 에서 파일을 받아 형식을 검증하고 SHA-256 을 계산한다
 *  - mirror_allowed 면 우리 스토리지에 저장, source_redirect 면 URL 만 등록
 *  - manual_review 정책이면 자동 공개하지 않고 검토 대기
 *  - 같은 URL 의 내용이 바뀌었으면 changed 로 기록 후 새 내용으로 다시 게시
 */
export async function handleVerifyArtifact(ctx: IngestionContext, job: Job) {
  const artifactId = String(job.payload.artifactId);
  const { db, logger } = ctx;
  const now = ctx.now();
  const { artifact: previous } = await loadArtifact(ctx, artifactId);
  await db
    .update(sourceArtifacts)
    .set({ status: "verifying", updatedAt: now })
    .where(eq(sourceArtifacts.id, artifactId));

  let download: Awaited<ReturnType<typeof downloadArtifactBytes>>;
  try {
    download = await downloadArtifactBytes(ctx, artifactId);
  } catch (error) {
    const e = toIngestionError(error);
    const gone = e.code === "HTTP_404" || e.code === "HTTP_410";
    // 네트워크/5xx 는 job 재시도, 404 는 아직 공개 전이거나 삭제됨
    await db
      .update(sourceArtifacts)
      .set({
        status: gone ? "unavailable" : e.retryable ? "discovered" : "failed",
        statusReason: `${e.code}: ${e.message}`.slice(0, 300),
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(sourceArtifacts.id, artifactId));
    throw e;
  }
  const { artifact, source, res, expected } = download;
  const result = validateArtifact({
    status: res.status,
    contentType: res.contentType,
    bytes: res.bytes,
    expected,
  });
  if (!result.ok) {
    await db
      .update(sourceArtifacts)
      .set({
        status: "failed",
        statusReason: `${result.code}: ${result.message}`,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(sourceArtifacts.id, artifactId));
    await db.insert(ingestionErrors).values({
      sourceId: source.id,
      url: redactUrl(artifact.sourceUrl),
      code: result.code,
      message: result.message,
      retryable: false,
    });
    logger.warn("artifact.rejected", { artifactId, source: source.id, code: result.code });
    throw new ArtifactValidationError(result.code, result.message);
  }

  const contentChanged = Boolean(artifact.sha256 && artifact.sha256 !== result.sha256);
  if (contentChanged) {
    logger.warn("artifact.changed", {
      artifactId,
      source: source.id,
      previousSha256: artifact.sha256,
      sha256: result.sha256,
    });
    await db
      .update(sourceArtifacts)
      .set({ status: "changed", statusReason: "content changed at the same URL", updatedAt: now })
      .where(eq(sourceArtifacts.id, artifactId));
  }
  if (!contentChanged && artifact.sha256 === result.sha256 && artifact.verifiedAt) {
    // 재검증: 내용이 같으면 이전 상태(ready / 검토 대기 / 관리자 승인)를 유지하고 확인 시각만 갱신
    const keep =
      previous.status === "ready" || previous.status === "manual_review"
        ? previous.status
        : artifact.deliveryPolicy === "manual_review"
          ? "manual_review"
          : "ready";
    await db
      .update(sourceArtifacts)
      .set({ status: keep, statusReason: null, lastCheckedAt: now, updatedAt: now })
      .where(eq(sourceArtifacts.id, artifactId));
    if (keep === "ready") {
      // 게시가 누락됐던 경우를 복구 (같은 버전이면 dedupe 로 무시됨)
      await enqueuePublish(
        ctx,
        { examId: artifact.examId, subject: artifact.subject, type: artifact.type },
        `${artifact.id}:${result.sha256}`,
      );
    }
    return;
  }

  let storageKey: string | null = artifact.storageKey;
  if (artifact.deliveryPolicy === "mirror_allowed") {
    const [exam] = await db.select().from(exams).where(eq(exams.id, artifact.examId));
    const ext = expected === "audio" ? "mp3" : "pdf";
    storageKey = `official/${exam!.slug}/${artifact.subject}/${artifact.type}-${result.sha256.slice(0, 16)}.${ext}`;
    await ctx.storage.putObject({
      key: storageKey,
      body: res.bytes,
      contentType: result.mimeType,
      sha256: result.sha256,
    });
  }

  const nextStatus = artifact.deliveryPolicy === "manual_review" ? "manual_review" : "ready";
  await db
    .update(sourceArtifacts)
    .set({
      status: nextStatus,
      statusReason: contentChanged ? "re-verified after content change" : null,
      sha256: result.sha256,
      fileSize: result.size,
      mimeType: result.mimeType,
      storageKey,
      lastCheckedAt: now,
      verifiedAt: now,
      updatedAt: now,
    })
    .where(eq(sourceArtifacts.id, artifactId));
  logger.info("artifact.verified", {
    artifactId,
    source: source.id,
    examId: artifact.examId,
    subject: artifact.subject,
    artifactType: artifact.type,
    sha256: result.sha256,
    policy: artifact.deliveryPolicy,
  });

  if (nextStatus === "manual_review") {
    const [exam] = await db.select().from(exams).where(eq(exams.id, artifact.examId));
    logger.info("artifact.manual_review", { artifactId, source: source.id });
    await ctx.notifier.notify({
      kind: "manual_review_needed",
      examLabel: exam ? examLabel(exam) : artifact.examId,
      items: [`${artifact.subject} ${artifact.type}`],
    });
    return;
  }
  await enqueuePublish(
    ctx,
    { examId: artifact.examId, subject: artifact.subject, type: artifact.type },
    `${artifact.id}:${result.sha256}`,
  );
}

export async function enqueuePublish(
  ctx: IngestionContext,
  slot: { examId: string; subject: Subject; type: FileType },
  version: string,
) {
  await enqueueJob(ctx.db, {
    runAt: ctx.now(),
    type: "publish_artifact",
    payload: slot,
    dedupeKey: `publish:${slot.examId}:${slot.subject}:${slot.type}:${version}`,
  });
}

/** PUBLISH: 슬롯 단위로 즉시 공개 + 페이지 재생성 + (영어 해설이면) 단어장 처리 예약 */
export async function handlePublishArtifact(ctx: IngestionContext, job: Job) {
  const slot = job.payload as { examId: string; subject: Subject; type: FileType };
  const outcome = await publishSlot(ctx, slot);
  if (!outcome.published) return;
  await ctx.revalidator.revalidatePaths(outcome.examPaths);

  // 시험 일정 상태 갱신 (자료가 하나라도 공개되면 published)
  await ctx.db
    .update(examSchedules)
    .set({ status: "published", updatedAt: ctx.now() })
    .where(
      and(
        eq(examSchedules.examId, slot.examId),
        inArray(examSchedules.status, ["scheduled", "watching"]),
      ),
    );

  if (
    slot.subject === "english" &&
    slot.type === "solution" &&
    process.env.VOCABULARY_PIPELINE_ENABLED !== "false"
  ) {
    const [file] = await ctx.db
      .select({ sourceArtifactId: examFiles.sourceArtifactId })
      .from(examFiles)
      .where(
        and(
          eq(examFiles.examId, slot.examId),
          eq(examFiles.subject, "english"),
          eq(examFiles.type, "solution"),
        ),
      );
    const [artifact] = file?.sourceArtifactId
      ? await ctx.db
          .select()
          .from(sourceArtifacts)
          .where(eq(sourceArtifacts.id, file.sourceArtifactId))
      : [];
    if (artifact?.sha256) {
      await enqueueJob(ctx.db, {
        runAt: ctx.now(),
        type: "extract_vocabulary",
        payload: { artifactId: artifact.id },
        dedupeKey: `vocab:${artifact.id}:${artifact.sha256}`,
        maxAttempts: 3,
      });
    }
  }
}
