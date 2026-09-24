import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import { examFiles, exams, examSources, sourceArtifacts } from "../../db/schema";
import type { ArtifactDeliveryPolicy, FileType, Subject } from "../../lib/constants";
import { FILE_TYPE_LABELS, SUBJECT_LABELS } from "../../lib/constants";
import { examPath } from "../../lib/exam-path";
import type { IngestionContext } from "../context";
import { enqueueJob } from "../jobs/queue";
import { rankSources } from "../sources/config";
import type { DiscoveredArtifact, SourceConfig } from "../types";
import { sanitizeFileName } from "../verify/artifact-validator";
import { examLabel } from "./exams";
import { examFileConflict } from "./slots";
import { loadPriorities } from "./sources";

type Tx = Pick<Database, "select" | "insert" | "update">;
export type SourceArtifactRow = typeof sourceArtifacts.$inferSelect;

const MIME_HINT: Record<FileType, string> = {
  question: "application/pdf",
  solution: "application/pdf",
  listening_audio: "audio/mpeg",
  listening_script: "application/pdf",
  vocabulary_pdf: "application/pdf",
};

export function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function defaultFileName(
  exam: { year: number; grade: number; month: number },
  subject: Subject,
  type: FileType,
): string {
  const ext = type === "listening_audio" ? "mp3" : "pdf";
  return `${exam.year}년 고${exam.grade} ${exam.month}월 ${SUBJECT_LABELS[subject]} ${FILE_TYPE_LABELS[type]}.${ext}`;
}

export type ArtifactUpsertAction = "created" | "url_changed" | "unchanged";

/**
 * 발견한 자료를 source_artifacts 에 기록한다. (source, 시험, 과목, 종류) 슬롯당 1건 — idempotent.
 *  - 새 자료 또는 URL 변경 → status=discovered + verify job
 *  - 같은 URL → lastCheckedAt 만 유지 (내용 변경은 주기적 재검증 job 이 확인)
 */
export async function upsertDiscoveredArtifact(
  db: Tx,
  input: {
    examId: string;
    exam: { year: number; grade: number; month: number };
    source: SourceConfig;
    artifact: DiscoveredArtifact;
    now: Date;
  },
): Promise<{ id: string; action: ArtifactUpsertAction }> {
  const { artifact, source, now } = input;
  const fileName = sanitizeFileName(
    defaultFileName(input.exam, artifact.subject, artifact.type),
    "file.pdf",
  );
  const [existing] = await db
    .select()
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.sourceId, source.id),
        eq(sourceArtifacts.examId, input.examId),
        eq(sourceArtifacts.subject, artifact.subject),
        eq(sourceArtifacts.type, artifact.type),
      ),
    );

  let id: string;
  let action: ArtifactUpsertAction;
  if (!existing) {
    const rows = await db
      .insert(sourceArtifacts)
      .values({
        examId: input.examId,
        sourceId: source.id,
        subject: artifact.subject,
        type: artifact.type,
        sourceUrl: artifact.url,
        originalFileName: fileName,
        mimeType: MIME_HINT[artifact.type],
        deliveryPolicy: source.deliveryPolicy,
        status: "discovered",
        sourcePublishedAt: artifact.publishedAt ? new Date(artifact.publishedAt) : null,
        firstDiscoveredAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: sourceArtifacts.id });
    if (!rows[0]) {
      // 동시에 다른 worker 가 먼저 넣었다 → 다음 실행에서 unchanged 로 처리된다
      const [again] = await db
        .select({ id: sourceArtifacts.id })
        .from(sourceArtifacts)
        .where(
          and(
            eq(sourceArtifacts.sourceId, source.id),
            eq(sourceArtifacts.examId, input.examId),
            eq(sourceArtifacts.subject, artifact.subject),
            eq(sourceArtifacts.type, artifact.type),
          ),
        );
      return { id: again!.id, action: "unchanged" };
    }
    id = rows[0].id;
    action = "created";
  } else if (existing.sourceUrl !== artifact.url) {
    await db
      .update(sourceArtifacts)
      .set({
        sourceUrl: artifact.url,
        status: "changed",
        statusReason: "source URL changed",
        updatedAt: now,
      })
      .where(eq(sourceArtifacts.id, existing.id));
    id = existing.id;
    action = "url_changed";
  } else {
    id = existing.id;
    action = "unchanged";
    // 실패/사라졌던 자료가 다시 목록에 보이면 재검증
    if (existing.status === "unavailable") {
      await db
        .update(sourceArtifacts)
        .set({ status: "discovered", statusReason: "reappeared", updatedAt: now })
        .where(eq(sourceArtifacts.id, existing.id));
      action = "url_changed";
    }
  }

  if (action !== "unchanged") {
    await enqueueJob(db, {
      runAt: now,
      type: "verify_artifact",
      payload: { artifactId: id },
      dedupeKey: `verify:${id}:${urlHash(artifact.url)}`,
    });
  }
  return { id, action };
}

export interface PublishOutcome {
  published: boolean;
  reason: string;
  examPaths: string[];
}

/**
 * 한 슬롯(시험·과목·종류)의 공개 파일을 결정해 exam_files 에 반영한다.
 * ready 상태인 후보 중 시험 유형별 source 우선순위가 가장 높은 것을 쓴다.
 * 자료는 슬롯 단위로 독립적으로 공개된다 (다른 과목/종류를 기다리지 않음).
 */
export async function publishSlot(
  ctx: IngestionContext,
  slot: { examId: string; subject: Subject; type: FileType },
): Promise<PublishOutcome> {
  const { db, now } = ctx;
  const [exam] = await db.select().from(exams).where(eq(exams.id, slot.examId));
  if (!exam) return { published: false, reason: "exam not found", examPaths: [] };

  const candidates = await db
    .select({ artifact: sourceArtifacts, sourceName: examSources.name })
    .from(sourceArtifacts)
    .innerJoin(examSources, eq(examSources.id, sourceArtifacts.sourceId))
    .where(
      and(
        eq(sourceArtifacts.examId, slot.examId),
        eq(sourceArtifacts.subject, slot.subject),
        eq(sourceArtifacts.type, slot.type),
        inArray(sourceArtifacts.status, ["ready"]),
      ),
    );
  if (candidates.length === 0)
    return { published: false, reason: "no ready artifact", examPaths: [] };

  const priorities = await loadPriorities(db, exam.examType);
  const order = rankSources(
    candidates.map((c) => c.artifact.sourceId),
    priorities,
  );
  const best = candidates.find((c) => c.artifact.sourceId === order[0])!;
  const a = best.artifact;

  const [current] = await db
    .select()
    .from(examFiles)
    .where(
      and(
        eq(examFiles.examId, slot.examId),
        eq(examFiles.subject, slot.subject),
        eq(examFiles.type, slot.type),
        isNull(examFiles.courseId),
      ),
    );
  // 수동 override(관리자 등록) 또는 1차 MVP 데이터는 자동 수집이 덮어쓰지 않는다
  if (current && current.sourceArtifactId === null) {
    return { published: false, reason: "manual file present (not overwritten)", examPaths: [] };
  }

  const delivery = deliveryFor(a.deliveryPolicy, a);
  if (!delivery) return { published: false, reason: "artifact not deliverable", examPaths: [] };
  if (
    current &&
    current.sourceArtifactId === a.id &&
    current.externalUrl === delivery.externalUrl &&
    current.storageKey === delivery.storageKey &&
    current.fileSize === a.fileSize
  ) {
    return { published: false, reason: "already published", examPaths: [] };
  }

  const values = {
    examId: slot.examId,
    subject: slot.subject,
    type: slot.type,
    deliveryType: delivery.deliveryType,
    storageKey: delivery.storageKey,
    externalUrl: delivery.externalUrl,
    artifactOrigin: "official" as const,
    sourceArtifactId: a.id,
    sourceLabel: best.sourceName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    originalFileName: a.originalFileName,
    updatedAt: now(),
  };
  await db
    .insert(examFiles)
    .values(values)
    .onConflictDoUpdate({ ...examFileConflict(null), set: values });

  ctx.logger.info("artifact.published", {
    examId: slot.examId,
    source: a.sourceId,
    subject: slot.subject,
    artifactType: slot.type,
    deliveryType: delivery.deliveryType,
  });
  await ctx.notifier.notify({
    kind: "artifacts_published",
    examLabel: examLabel(exam),
    items: [`${SUBJECT_LABELS[slot.subject]} ${FILE_TYPE_LABELS[slot.type]}`],
  });
  const key = { year: exam.year, grade: exam.grade as 1 | 2 | 3, month: exam.month };
  return {
    published: true,
    reason: "published",
    examPaths: [examPath(key), examPath(key, slot.subject)],
  };
}

function deliveryFor(
  policy: ArtifactDeliveryPolicy,
  a: Pick<SourceArtifactRow, "storageKey" | "sourceUrl">,
): {
  deliveryType: "storage" | "redirect";
  storageKey: string | null;
  externalUrl: string | null;
} | null {
  if (policy === "mirror_allowed") {
    return a.storageKey
      ? { deliveryType: "storage", storageKey: a.storageKey, externalUrl: null }
      : null;
  }
  // source_redirect (기본) 과 관리자가 승인한 manual_review 는 검증된 공식 URL 로 연결
  return { deliveryType: "redirect", storageKey: null, externalUrl: a.sourceUrl };
}
