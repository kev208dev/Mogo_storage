import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/client";
import { courses, examFiles, exams, examSources, sourceArtifacts } from "../../db/schema";
import type { ArtifactDeliveryPolicy, FileType, Subject } from "../../lib/constants";
import { FILE_TYPE_LABELS, SUBJECT_LABELS } from "../../lib/constants";
import { courseByCode } from "../../lib/courses";
import { examCoursePath, examPath } from "../../lib/exam-path";
import { regimeFor } from "../../lib/regimes";
import {
  applyRegime,
  courseSlotKey,
  resolveCourse,
  type CourseAlias,
  type CourseResolution,
} from "../canonical/course";
import type { IngestionContext } from "../context";
import { enqueueJob } from "../jobs/queue";
import { rankSources } from "../sources/config";
import type { DiscoveredArtifact, SourceConfig } from "../types";
import { sanitizeFileName } from "../verify/artifact-validator";
import { examLabel } from "./exams";
import { courseIs, examFileConflict } from "./slots";
import { loadPriorities } from "./sources";

type Tx = Pick<Database, "select" | "insert" | "update" | "delete">;
export type SourceArtifactRow = typeof sourceArtifacts.$inferSelect;

const MIME_HINT: Record<FileType, string> = {
  question: "application/pdf",
  solution: "application/pdf",
  listening_audio: "audio/mpeg",
  listening_script: "application/pdf",
  vocabulary_pdf: "application/pdf",
  vocabulary_test: "application/pdf",
  vocabulary_test_answers: "application/pdf",
  dictation_sheet: "application/pdf",
  dictation_answers: "application/pdf",
  question_checklist: "application/pdf",
};

export function urlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function defaultFileName(
  exam: { year: number; grade: number; month: number },
  subject: Subject,
  type: FileType,
  courseCode: string | null = null,
): string {
  const ext = type === "listening_audio" ? "mp3" : "pdf";
  const area = courseCode
    ? (courseByCode(courseCode)?.name ?? SUBJECT_LABELS[subject])
    : SUBJECT_LABELS[subject];
  return `${exam.year}년 고${exam.grade} ${exam.month}월 ${area} ${FILE_TYPE_LABELS[type]}.${ext}`;
}

/**
 * DB alias(관리자 mapping)와 시험 체제까지 반영한 최종 course 판정.
 * 체제에 맞지 않는 카탈로그 판정은 확정하지 않는다 (manual_review). source 표기는 그대로 보존된다.
 */
export function finalCourseResolution(
  artifact: DiscoveredArtifact,
  sourceId: string,
  aliases: CourseAlias[],
  exam?: { year: number; grade: number },
): CourseResolution {
  let resolution = artifact.course;
  if (artifact.courseLabel) {
    const again = resolveCourse(artifact.courseLabel, {
      subject: artifact.subject,
      sourceId,
      aliases,
      regime: exam ? regimeFor(exam).code : null,
    });
    // 관리자 alias 는 코드 카탈로그 판정보다 우선
    if (again.status === "resolved" && again.via === "alias") resolution = again;
    else if (resolution.status !== "resolved" && again.status !== "none") resolution = again;
  }
  return exam ? applyRegime(resolution, exam) : resolution;
}

export type ArtifactUpsertAction = "created" | "url_changed" | "unchanged";

/**
 * 발견한 자료를 source_artifacts 에 기록한다 — idempotent.
 * identity = (source, 시험, 영역, slotKey[course], 자료 종류). 파일명은 identity 가 아니다.
 *  - 새 자료 또는 URL 변경 → status=discovered + verify job
 *  - course 가 모호하거나 여러 과목 압축 파일이면 검증 후 manual_review (자동 게시 안 함)
 *  - 예전에 모호했던 자료가 alias 로 확정되면 기존 행을 확정 슬롯으로 옮긴다 (중복 생성 안 함)
 */
export async function upsertDiscoveredArtifact(
  db: Tx,
  input: {
    examId: string;
    exam: { year: number; grade: number; month: number };
    source: SourceConfig;
    artifact: DiscoveredArtifact;
    now: Date;
    aliases?: CourseAlias[];
    /** false: metadata-only (URL 만 기록, 검증 job 을 만들지 않음) */
    verify?: boolean;
  },
): Promise<{ id: string; action: ArtifactUpsertAction; slotKey: string; courseId: string | null }> {
  const { artifact, source, now } = input;
  const resolution = finalCourseResolution(artifact, source.id, input.aliases ?? [], input.exam);
  const slotKey = courseSlotKey(resolution);
  const courseId = resolution.status === "resolved" ? await courseIdFor(db, resolution.code) : null;
  const fileName = sanitizeFileName(
    defaultFileName(
      input.exam,
      artifact.subject,
      artifact.type,
      resolution.status === "resolved" ? resolution.code : null,
    ),
    "file.pdf",
  );
  const slotWhere = (key: string) =>
    and(
      eq(sourceArtifacts.sourceId, source.id),
      eq(sourceArtifacts.examId, input.examId),
      eq(sourceArtifacts.subject, artifact.subject),
      eq(sourceArtifacts.type, artifact.type),
      eq(sourceArtifacts.slotKey, key),
    );

  const [existing] = await db.select().from(sourceArtifacts).where(slotWhere(slotKey));
  if (!existing && resolution.status === "resolved" && artifact.courseLabel) {
    // 같은 URL 이 예전에 모호한 슬롯으로 저장돼 있으면 그 행을 확정 슬롯으로 옮긴다
    const [pending] = await db
      .select()
      .from(sourceArtifacts)
      .where(
        and(
          eq(sourceArtifacts.sourceId, source.id),
          eq(sourceArtifacts.examId, input.examId),
          eq(sourceArtifacts.subject, artifact.subject),
          eq(sourceArtifacts.type, artifact.type),
          eq(sourceArtifacts.sourceUrl, artifact.url),
        ),
      );
    if (pending?.slotKey.startsWith("unresolved:")) {
      const verified = Boolean(pending.verifiedAt);
      const nextStatus = !verified
        ? "discovered"
        : pending.deliveryPolicy === "manual_review"
          ? "manual_review"
          : "ready";
      await db
        .update(sourceArtifacts)
        .set({
          slotKey,
          courseId,
          originalFileName: fileName,
          status: nextStatus,
          statusReason: `course resolved by alias (${artifact.courseLabel})`,
          updatedAt: now,
        })
        .where(eq(sourceArtifacts.id, pending.id));
      if (nextStatus === "ready") {
        await enqueuePublishJob(
          db,
          now,
          { examId: input.examId, subject: artifact.subject, courseId, type: artifact.type },
          `${pending.id}:${pending.contentFingerprint ?? pending.sha256}:alias`,
        );
      } else if (nextStatus === "discovered") {
        await enqueueJob(db, {
          runAt: now,
          type: "verify_artifact",
          payload: { artifactId: pending.id },
          dedupeKey: `verify:${pending.id}:${urlHash(artifact.url)}:${slotKey}`,
        });
      }
      return { id: pending.id, action: "url_changed", slotKey, courseId };
    }
  }

  const initialStatus = artifact.containerType === "archive" ? "manual_review" : "discovered";
  const initialReason =
    artifact.containerType === "archive"
      ? "archive file (may contain several courses) — extraction not implemented, review required"
      : resolution.status === "ambiguous"
        ? `ambiguous course "${artifact.courseLabel}" (candidates: ${resolution.candidates.join(", ")})${resolution.reason ? ` — ${resolution.reason}` : ""}`
        : null;

  let id: string;
  let action: ArtifactUpsertAction;
  if (!existing) {
    const rows = await db
      .insert(sourceArtifacts)
      .values({
        examId: input.examId,
        sourceId: source.id,
        subject: artifact.subject,
        courseId,
        slotKey,
        courseLabel: artifact.courseLabel,
        sourceSubjectLabel: artifact.sourceSubjectLabel,
        sourceLabel: artifact.sourceLabel,
        type: artifact.type,
        sourceUrl: artifact.url,
        containerType: artifact.containerType,
        containsMultipleCourses: artifact.containsMultipleCourses,
        originalFileName: fileName,
        mimeType: MIME_HINT[artifact.type],
        deliveryPolicy: source.deliveryPolicy,
        status: initialStatus,
        statusReason: initialReason,
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
        .where(slotWhere(slotKey));
      return { id: again!.id, action: "unchanged", slotKey, courseId };
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
    // 이전 버전에서 저장된 행에는 원문 표기가 없다 → 다음 발견 때 채운다 (canonical 값은 건드리지 않음)
    if (existing.sourceLabel === null) {
      await db
        .update(sourceArtifacts)
        .set({
          sourceLabel: artifact.sourceLabel,
          sourceSubjectLabel: artifact.sourceSubjectLabel,
        })
        .where(eq(sourceArtifacts.id, existing.id));
    }
    // 실패/사라졌던 자료가 다시 목록에 보이면 재검증
    if (existing.status === "unavailable") {
      await db
        .update(sourceArtifacts)
        .set({ status: "discovered", statusReason: "reappeared", updatedAt: now })
        .where(eq(sourceArtifacts.id, existing.id));
      action = "url_changed";
    }
  }

  // 압축 파일은 PDF/MP3 검증 대상이 아니므로 verify 하지 않고 검토 대기로 둔다
  // metadata-only 수집은 URL 만 기록한다 (나중에 전체 수집 때 검증)
  if (input.verify === false) {
    if (action === "created") {
      await db
        .update(sourceArtifacts)
        .set({ statusReason: "metadata only (not verified yet)" })
        .where(and(eq(sourceArtifacts.id, id), eq(sourceArtifacts.status, "discovered")));
    }
  } else if (
    artifact.containerType !== "archive" &&
    (action !== "unchanged" ||
      // metadata-only 로 URL 만 기록됐던 자료: 전체 수집 때 검증을 시작한다
      (existing?.status === "discovered" && !existing.verifiedAt))
  ) {
    await enqueueJob(db, {
      runAt: now,
      type: "verify_artifact",
      payload: { artifactId: id },
      dedupeKey: `verify:${id}:${urlHash(artifact.url)}`,
    });
  }
  return { id, action, slotKey, courseId };
}

async function courseIdFor(db: Pick<Database, "select">, code: string): Promise<string | null> {
  const [row] = await db.select({ id: courses.id }).from(courses).where(eq(courses.code, code));
  return row?.id ?? null;
}

export interface Slot {
  examId: string;
  subject: Subject;
  courseId: string | null;
  type: FileType;
}

export async function enqueuePublishJob(
  db: Pick<Database, "insert">,
  now: Date,
  slot: Slot,
  version: string,
) {
  await enqueueJob(db, {
    runAt: now,
    type: "publish_artifact",
    payload: { ...slot },
    dedupeKey: `publish:${slot.examId}:${slot.subject}:${slot.courseId ?? "-"}:${slot.type}:${version}`,
  });
}

export interface PublishOutcome {
  published: boolean;
  reason: string;
  examPaths: string[];
}

/**
 * 한 슬롯(시험·영역·세부과목·종류)의 공개 파일을 결정해 exam_files 에 반영한다.
 * ready 상태 후보 중 시험 유형별 source 우선순위가 가장 높은 것을 쓴다 — 우선순위는 슬롯(artifact) 단위라서
 * KICE 에 사회·문화가 있으면 KICE, KICE 에 생활과 윤리가 없고 EBSi 에만 있으면 EBSi 를 쓴다.
 * 자료는 슬롯 단위로 독립적으로 공개된다 (영역 전체가 모이기를 기다리지 않음).
 */
export async function publishSlot(ctx: IngestionContext, slot: Slot): Promise<PublishOutcome> {
  const { db, now } = ctx;
  const courseId = slot.courseId ?? null;
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
        courseIs(sourceArtifacts.courseId, courseId),
        eq(sourceArtifacts.type, slot.type),
        inArray(sourceArtifacts.status, ["ready"]),
      ),
    );
  // 모호한 course 는 확정 전까지 게시하지 않는다
  const eligible = candidates.filter((c) => !c.artifact.slotKey.startsWith("unresolved:"));
  if (eligible.length === 0)
    return { published: false, reason: "no ready artifact", examPaths: [] };

  const priorities = await loadPriorities(db, exam.examType);
  const order = rankSources(
    eligible.map((c) => c.artifact.sourceId),
    priorities,
  );
  const best = eligible.find((c) => c.artifact.sourceId === order[0])!;
  const a = best.artifact;

  const [current] = await db
    .select()
    .from(examFiles)
    .where(
      and(
        eq(examFiles.examId, slot.examId),
        eq(examFiles.subject, slot.subject),
        courseIs(examFiles.courseId, courseId),
        eq(examFiles.type, slot.type),
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
    courseId,
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
    .onConflictDoUpdate({ ...examFileConflict(courseId), set: values });

  const courseCode = courseId ? await courseCodeFor(db, courseId) : null;
  ctx.logger.info("artifact.published", {
    examId: slot.examId,
    source: a.sourceId,
    subject: slot.subject,
    course: courseCode,
    artifactType: slot.type,
    deliveryType: delivery.deliveryType,
  });
  const courseName = courseCode ? courseByCode(courseCode)?.name : null;
  await ctx.notifier.notify({
    kind: "artifacts_published",
    examLabel: examLabel(exam),
    items: [`${courseName ?? SUBJECT_LABELS[slot.subject]} ${FILE_TYPE_LABELS[slot.type]}`],
  });
  const key = { year: exam.year, grade: exam.grade as 1 | 2 | 3, month: exam.month };
  const paths = [examPath(key), examPath(key, slot.subject)];
  if (courseCode) paths.push(examCoursePath(key, slot.subject, courseCode));
  return { published: true, reason: "published", examPaths: paths };
}

async function courseCodeFor(
  db: Pick<Database, "select">,
  courseId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ code: courses.code })
    .from(courses)
    .where(eq(courses.id, courseId));
  return row?.code ?? null;
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
