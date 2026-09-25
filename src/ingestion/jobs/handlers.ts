import { and, eq, inArray, isNull } from "drizzle-orm";
import { examFiles, exams, examSchedules, ingestionErrors, sourceArtifacts } from "../../db/schema";
import type { IngestionContext } from "../context";
import { ArtifactValidationError, IngestionError, redactUrl, toIngestionError } from "../errors";
import {
  enqueuePublishJob,
  publishSlot,
  type Slot,
  type SourceArtifactRow,
} from "../pipeline/artifacts";
import { examLabel } from "../pipeline/exams";
import { loadSource } from "../pipeline/sources";
import { createFetcherFor } from "../sources/registry";
import type { SourceConfig } from "../types";
import {
  expectedKindFor,
  MAX_ARTIFACT_BYTES,
  PROBE_BYTES,
  validateArtifact,
  validateArtifactProbe,
} from "../verify/artifact-validator";
import { isOperatorImport } from "../manual-import/source";
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
 * 검증 방식:
 *  - full: mirror_allowed (우리 스토리지에 저장해야 하므로 전체 다운로드 + SHA-256)
 *  - probe: source_redirect / manual_review — 파일 전체를 받지 않고 앞부분과 header 로
 *    HTTP status · Content-Type · magic bytes · 크기 · redirect 최종 목적지(허용 도메인)를 확인한다.
 *    (단어장 처리처럼 내용이 필요한 작업은 그 job 이 따로 전체를 받는다)
 */
export function verificationModeFor(policy: SourceArtifactRow["deliveryPolicy"]): "full" | "probe" {
  return policy === "mirror_allowed" ? "full" : "probe";
}

interface VerifiedContent {
  mode: "full" | "probe";
  /** 내용 버전 식별자 (full: sha256, probe: probe fingerprint) */
  version: string;
  sha256: string | null;
  size: number | null;
  mimeType: string;
  finalUrl: string;
  bytes: Uint8Array | null;
}

async function fetchAndValidate(
  ctx: IngestionContext,
  artifact: SourceArtifactRow,
  source: SourceConfig,
): Promise<{ ok: true; content: VerifiedContent } | { ok: false; code: string; message: string }> {
  const fetcher = createFetcherFor(source, ctx.adapterOptions);
  const expected = expectedKindFor(artifact.type);
  const mode = verificationModeFor(artifact.deliveryPolicy);
  if (mode === "probe") {
    const res = await fetcher.fetch(artifact.sourceUrl, {
      probeBytes: PROBE_BYTES,
      maxBytes: MAX_ARTIFACT_BYTES[expected],
    });
    const result = validateArtifactProbe({
      status: res.status,
      contentType: res.contentType,
      headBytes: res.bytes,
      truncated: Boolean(res.truncated),
      declaredSize: res.declaredSize ?? null,
      finalUrl: res.url,
      allowedHosts: source.allowedHosts.length
        ? source.allowedHosts
        : [new URL(source.baseUrl).hostname],
      expected,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    });
    if (!result.ok) return result;
    return {
      ok: true,
      content: {
        mode,
        version: result.fingerprint,
        sha256: null,
        size: result.size,
        mimeType: result.mimeType,
        finalUrl: result.finalUrl,
        bytes: null,
      },
    };
  }
  const res = await fetcher.fetch(artifact.sourceUrl, { maxBytes: MAX_ARTIFACT_BYTES[expected] });
  const result = validateArtifact({
    status: res.status,
    contentType: res.contentType,
    bytes: res.bytes,
    expected,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    content: {
      mode,
      version: result.sha256,
      sha256: result.sha256,
      size: result.size,
      mimeType: result.mimeType,
      finalUrl: res.url,
      bytes: res.bytes,
    },
  };
}

/** 이전 검증의 내용 버전 (이전 버전 코드로 검증된 행은 sha256 만 있다) */
function previousVersion(a: SourceArtifactRow): { mode: string; version: string } | null {
  if (a.contentFingerprint)
    return { mode: a.verificationMode ?? "full", version: a.contentFingerprint };
  if (a.sha256) return { mode: "full", version: a.sha256 };
  return null;
}

/**
 * VERIFY (+ MIRROR or REGISTER_URL):
 *  - 공식 URL 을 검증 (정책에 따라 full/probe)
 *  - mirror_allowed 면 우리 스토리지에 저장, source_redirect 면 검증된 URL 만 등록 (파일을 저장하지 않음)
 *  - manual_review 정책이면 자동 공개하지 않고 검토 대기
 *  - 같은 URL 의 내용이 바뀌었으면 changed 로 기록 후 새 내용으로 다시 게시
 */
export async function handleVerifyArtifact(ctx: IngestionContext, job: Job) {
  const artifactId = String(job.payload.artifactId);
  const { db, logger } = ctx;
  const now = ctx.now();
  const { artifact, source } = await loadArtifact(ctx, artifactId);
  // 운영자 입력 자료는 서버가 URL 에 요청하지 않는다 (robots.txt 가 자동 수집을 막는 source). 관리자 브라우저 확인만 인정
  if (isOperatorImport(artifact.sourceId)) {
    logger.info("ingestion.skipped", { artifactId, reason: "operator import is never fetched" });
    return;
  }
  const previous = artifact;
  await db
    .update(sourceArtifacts)
    .set({ status: "verifying", updatedAt: now })
    .where(eq(sourceArtifacts.id, artifactId));

  let outcome: Awaited<ReturnType<typeof fetchAndValidate>>;
  try {
    outcome = await fetchAndValidate(ctx, artifact, source);
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
  if (!outcome.ok) {
    await db
      .update(sourceArtifacts)
      .set({
        status: "failed",
        statusReason: `${outcome.code}: ${outcome.message}`,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(sourceArtifacts.id, artifactId));
    await db.insert(ingestionErrors).values({
      sourceId: source.id,
      url: redactUrl(artifact.sourceUrl),
      code: outcome.code,
      message: outcome.message,
      retryable: false,
    });
    logger.warn("artifact.rejected", { artifactId, source: source.id, code: outcome.code });
    throw new ArtifactValidationError(outcome.code, outcome.message);
  }
  const content = outcome.content;
  const prev = previousVersion(artifact);
  // 검증 방식이 바뀐 경우(예: full → probe)는 버전 형식이 달라 비교하지 않는다
  const comparable = prev && prev.mode === content.mode;
  const contentChanged = Boolean(comparable && prev.version !== content.version);
  if (contentChanged) {
    logger.warn("artifact.changed", {
      artifactId,
      source: source.id,
      previousVersion: prev!.version,
      version: content.version,
    });
    await db
      .update(sourceArtifacts)
      .set({ status: "changed", statusReason: "content changed at the same URL", updatedAt: now })
      .where(eq(sourceArtifacts.id, artifactId));
    const [changedExam] = await db.select().from(exams).where(eq(exams.id, artifact.examId));
    await ctx.notifier.notify({
      kind: "artifact_changed",
      examLabel: changedExam ? examLabel(changedExam) : artifact.examId,
      item: `${artifact.subject}${artifact.slotKey ? `/${artifact.slotKey}` : ""} ${artifact.type} (${source.id})`,
    });
  }
  if (comparable && !contentChanged && artifact.verifiedAt) {
    // 재검증: 내용이 같으면 이전 상태(ready / 검토 대기 / 관리자 승인)를 유지하고 확인 시각만 갱신
    const keep =
      previous.status === "ready" || previous.status === "manual_review"
        ? previous.status
        : artifact.deliveryPolicy === "manual_review" || artifact.slotKey.startsWith("unresolved:")
          ? "manual_review"
          : "ready";
    await db
      .update(sourceArtifacts)
      .set({
        status: keep,
        statusReason: keep === "manual_review" ? artifact.statusReason : null,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(sourceArtifacts.id, artifactId));
    if (keep === "ready") {
      // 게시가 누락됐던 경우를 복구 (같은 버전이면 dedupe 로 무시됨)
      await enqueuePublish(ctx, slotOf(artifact), `${artifact.id}:${content.version}`);
    }
    return;
  }

  let storageKey: string | null = artifact.storageKey;
  if (content.mode === "full" && content.bytes && content.sha256) {
    const [exam] = await db.select().from(exams).where(eq(exams.id, artifact.examId));
    const ext = expectedKindFor(artifact.type) === "audio" ? "mp3" : "pdf";
    const area =
      artifact.slotKey && !artifact.slotKey.startsWith("unresolved:")
        ? `${artifact.subject}/${artifact.slotKey}`
        : artifact.subject;
    // 안정된 key: exams/{year}/high{grade}/{MM}/{subject}/{course?}/{type}-{sha}.{ext} (외부 파일명은 쓰지 않는다)
    storageKey = `exams/${exam!.year}/high${exam!.grade}/${String(exam!.month).padStart(2, "0")}/${area}/${artifact.type}-${content.sha256.slice(0, 16)}.${ext}`;
    await ctx.storage.putObject({
      key: storageKey,
      body: content.bytes,
      contentType: content.mimeType,
      sha256: content.sha256,
    });
  }

  // course 가 모호하면(예: "윤리") 검증은 끝내되 관리자가 과목을 확정할 때까지 게시하지 않는다
  const unresolvedCourse = artifact.slotKey.startsWith("unresolved:");
  const nextStatus =
    artifact.deliveryPolicy === "manual_review" || unresolvedCourse ? "manual_review" : "ready";
  await db
    .update(sourceArtifacts)
    .set({
      status: nextStatus,
      statusReason: unresolvedCourse
        ? artifact.statusReason
        : contentChanged
          ? "re-verified after content change"
          : null,
      sha256: content.sha256 ?? (content.mode === "probe" ? null : artifact.sha256),
      verificationMode: content.mode,
      contentFingerprint: content.version,
      finalUrl: content.finalUrl,
      fileSize: content.size,
      mimeType: content.mimeType,
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
    mode: content.mode,
    version: content.version,
    policy: artifact.deliveryPolicy,
  });

  if (nextStatus === "manual_review") {
    const [exam] = await db.select().from(exams).where(eq(exams.id, artifact.examId));
    logger.info("artifact.manual_review", { artifactId, source: source.id });
    await ctx.notifier.notify({
      kind: "manual_review_needed",
      examLabel: exam ? examLabel(exam) : artifact.examId,
      items: [`${artifact.courseLabel ?? artifact.subject} ${artifact.type}`],
    });
    return;
  }
  await enqueuePublish(ctx, slotOf(artifact), `${artifact.id}:${content.version}`);
}

function slotOf(a: Pick<SourceArtifactRow, "examId" | "subject" | "courseId" | "type">): Slot {
  return { examId: a.examId, subject: a.subject, courseId: a.courseId, type: a.type };
}

export async function enqueuePublish(ctx: IngestionContext, slot: Slot, version: string) {
  await enqueuePublishJob(ctx.db, ctx.now(), slot, version);
}

/** PUBLISH: 슬롯 단위로 즉시 공개 + 페이지 재생성 + (영어 해설이면) 단어장 처리 예약 */
export async function handlePublishArtifact(ctx: IngestionContext, job: Job) {
  const payload = job.payload as Omit<Slot, "courseId"> & { courseId?: string | null };
  const slot: Slot = { ...payload, courseId: payload.courseId ?? null };
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
          isNull(examFiles.courseId),
        ),
      );
    const [artifact] = file?.sourceArtifactId
      ? await ctx.db
          .select()
          .from(sourceArtifacts)
          .where(eq(sourceArtifacts.id, file.sourceArtifactId))
      : [];
    const version = artifact?.contentFingerprint ?? artifact?.sha256;
    // 단어장 추출은 해설 PDF 를 내려받아야 하므로 운영자 입력(요청 금지) 자료는 대상이 아니다
    if (artifact && version && !isOperatorImport(artifact.sourceId)) {
      await enqueueJob(ctx.db, {
        runAt: ctx.now(),
        type: "extract_vocabulary",
        payload: { artifactId: artifact.id },
        dedupeKey: `vocab:${artifact.id}:${version}`,
        maxAttempts: 3,
      });
    }
  }
}
