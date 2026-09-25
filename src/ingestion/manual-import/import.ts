import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  examCourses,
  examFiles,
  examSchedules,
  examSources,
  exams,
  gradeCuts,
  listeningTracks,
  officialUrlImports,
  questions,
  sourceArtifacts,
  vocabulary,
} from "../../db/schema";
import type { FileType } from "../../lib/constants";
import { examPath } from "../../lib/exam-path";
import type { IngestionContext } from "../context";
import { IngestionError } from "../errors";
import { publishSlot } from "../pipeline/artifacts";
import { courseIdForCode } from "../pipeline/course-aliases";
import { ensureExamSubjects, upsertCanonicalExam } from "../pipeline/exams";
import { refreshWatchStates } from "../schedule/artifact-watch";
import { sanitizeFileName } from "../verify/artifact-validator";
import { parseCsv } from "./csv";
import { IMPORT_COLUMNS, importRowSchema, OFFICIAL_URL_HOSTS, REQUIRED_COLUMNS } from "./schema";
import { isOperatorImport, OPERATOR_IMPORT_SOURCE_ID } from "./source";

export { isOperatorImport, OPERATOR_IMPORT_SOURCE_ID } from "./source";

type Tx = Pick<Database, "select" | "selectDistinct" | "insert" | "update" | "delete">;

const MIME: Record<FileType, string> = {
  question: "application/pdf",
  solution: "application/pdf",
  listening_audio: "audio/mpeg",
  listening_script: "application/pdf",
  vocabulary_pdf: "application/pdf",
};

/** 운영자 입력 source 행 보장 (자동 수집 대상 아님: enabled=false, 기능 모두 꺼짐) */
export async function ensureOperatorImportSource(db: Pick<Database, "insert">) {
  await db
    .insert(examSources)
    .values({
      id: OPERATOR_IMPORT_SOURCE_ID,
      kind: "other_official",
      name: "공식 자료 (운영자 확인)",
      baseUrl: "https://www.ebsi.co.kr",
      allowedHosts: OFFICIAL_URL_HOSTS,
      deliveryPolicy: "manual_review",
      enabled: false,
      healthStatus: "disabled",
    })
    .onConflictDoUpdate({
      target: examSources.id,
      set: { allowedHosts: OFFICIAL_URL_HOSTS, enabled: false, updatedAt: new Date() },
    });
}

export type ImportRowStatus = "created" | "updated" | "unchanged" | "invalid";

export interface ImportResult {
  importId: string | null;
  dryRun: boolean;
  rows: Array<{ line: number; status: ImportRowStatus; errors?: string[]; artifactId?: string }>;
  counts: Record<ImportRowStatus, number>;
}

/**
 * CSV 입력 → 시험 · 영역 · 세부과목 · 공식 URL(manual_review). idempotent:
 *  - 같은 (시험, 영역, 세부과목, 자료 종류) 슬롯 + 같은 URL → unchanged
 *  - 같은 슬롯, 다른 URL → URL 교체 후 다시 검토 대기 (승인 전까지 기존 게시 유지)
 * 서버는 URL 을 열어보지 않는다. 형식·공식 도메인만 검사한다.
 */
export async function importOfficialUrls(
  db: Database,
  input: { csv: string; admin: string; fileName?: string | null; dryRun?: boolean; now?: Date },
): Promise<ImportResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);
  const parsed = parseCsv(input.csv);
  if (parsed.length === 0) throw new IngestionError("EMPTY_CSV", "CSV 가 비어 있습니다");
  const header = parsed[0]!.cells.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length)
    throw new IngestionError("BAD_HEADER", `CSV 헤더에 필수 열이 없습니다: ${missing.join(", ")}`);
  const unknown = header.filter((h) => h && !(IMPORT_COLUMNS as readonly string[]).includes(h));
  if (unknown.length)
    throw new IngestionError("BAD_HEADER", `알 수 없는 열: ${unknown.join(", ")}`);
  if (parsed.length - 1 > 5000)
    throw new IngestionError("TOO_MANY_ROWS", "한 번에 5000행까지 입력할 수 있습니다");

  const result: ImportResult = {
    importId: null,
    dryRun,
    rows: [],
    counts: { created: 0, updated: 0, unchanged: 0, invalid: 0 },
  };
  const seenSlots = new Map<string, { line: number; url: string }>();
  const push = (row: ImportResult["rows"][number]) => {
    result.rows.push(row);
    result.counts[row.status] += 1;
  };

  if (!dryRun) await ensureOperatorImportSource(db);

  for (const { line, cells } of parsed.slice(1)) {
    const record = Object.fromEntries(
      (IMPORT_COLUMNS as readonly string[]).map((c) => [c, cells[header.indexOf(c)] ?? ""]),
    );
    const check = importRowSchema.safeParse(record);
    if (!check.success) {
      push({ line, status: "invalid", errors: check.error.issues.map((i) => i.message) });
      continue;
    }
    const row = check.data;
    const slotKey = row.course_code ?? "";
    const slotId = `${row.year}-${row.grade}-${row.month}|${row.subject}|${slotKey}|${row.file_type}`;
    const dup = seenSlots.get(slotId);
    if (dup) {
      push({
        line,
        status: dup.url === row.official_url ? "unchanged" : "invalid",
        errors:
          dup.url === row.official_url
            ? undefined
            : [`${dup.line}번째 줄과 같은 슬롯에 다른 URL 이 있습니다`],
      });
      continue;
    }
    seenSlots.set(slotId, { line, url: row.official_url });
    if (dryRun) {
      push({ line, status: "unchanged" });
      continue;
    }

    try {
      const outcome = await db.transaction(async (tx) => {
        const canonical = {
          year: row.year,
          grade: row.grade,
          month: row.month,
          examType: row.exam_type,
          academicYear: row.exam_type === "school_mock" ? null : row.year + 1,
        };
        const exam = await upsertCanonicalExam(tx, canonical, { examDate: row.exam_date });
        if (row.organizer && !exam.isSample) {
          await tx
            .update(exams)
            .set({ organizer: row.organizer, updatedAt: now })
            .where(eq(exams.id, exam.examId));
        }
        await ensureExamSubjects(tx, exam.examId, [row.subject]);
        const courseId = row.course_code ? await courseIdForCode(tx, row.course_code) : null;
        if (row.course_code && !courseId)
          throw new IngestionError(
            "COURSE_NOT_SYNCED",
            `course ${row.course_code} 가 DB 에 없습니다`,
          );
        if (courseId)
          await tx
            .insert(examCourses)
            .values({ examId: exam.examId, courseId })
            .onConflictDoNothing();

        const fileName = sanitizeFileName(
          row.original_file_name ??
            decodeURIComponent(new URL(row.official_url).pathname.split("/").pop() ?? ""),
          `${row.year}-고${row.grade}-${row.month}월-${row.subject}-${row.file_type}.${row.file_type === "listening_audio" ? "mp3" : "pdf"}`,
        );
        const where = and(
          eq(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID),
          eq(sourceArtifacts.examId, exam.examId),
          eq(sourceArtifacts.subject, row.subject),
          eq(sourceArtifacts.type, row.file_type),
          eq(sourceArtifacts.slotKey, slotKey),
        );
        const [existing] = await tx.select().from(sourceArtifacts).where(where);
        if (!existing) {
          const [created] = await tx
            .insert(sourceArtifacts)
            .values({
              examId: exam.examId,
              sourceId: OPERATOR_IMPORT_SOURCE_ID,
              subject: row.subject,
              courseId,
              slotKey,
              courseLabel: row.course_code,
              sourceLabel: row.source_label,
              type: row.file_type,
              sourceUrl: row.official_url,
              originalFileName: fileName,
              mimeType: MIME[row.file_type],
              deliveryPolicy: "manual_review",
              verificationMode: "operator",
              status: "manual_review",
              statusReason: `operator import by ${input.admin} — 브라우저 확인 후 승인 필요 (서버는 URL 에 요청하지 않음)`,
              firstDiscoveredAt: now,
            })
            .returning({ id: sourceArtifacts.id });
          return { status: "created" as const, id: created!.id };
        }
        if (
          existing.sourceUrl === row.official_url &&
          existing.originalFileName === fileName &&
          existing.sourceLabel === row.source_label
        ) {
          return { status: "unchanged" as const, id: existing.id };
        }
        const urlChanged = existing.sourceUrl !== row.official_url;
        await tx
          .update(sourceArtifacts)
          .set({
            sourceUrl: row.official_url,
            originalFileName: fileName,
            sourceLabel: row.source_label,
            ...(urlChanged
              ? {
                  status: "manual_review" as const,
                  verifiedAt: null,
                  finalUrl: null,
                  statusReason: `URL changed by import (${input.admin}) — 다시 브라우저 확인 필요`,
                }
              : {}),
            updatedAt: now,
          })
          .where(eq(sourceArtifacts.id, existing.id));
        return { status: "updated" as const, id: existing.id };
      });
      push({ line, status: outcome.status, artifactId: outcome.id });
    } catch (error) {
      push({
        line,
        status: "invalid",
        errors: [error instanceof Error ? error.message.slice(0, 300) : String(error)],
      });
    }
  }

  if (!dryRun) {
    const [row] = await db
      .insert(officialUrlImports)
      .values({
        createdBy: input.admin,
        fileName: input.fileName ?? null,
        dryRun,
        rowCount: result.rows.length,
        createdCount: result.counts.created,
        updatedCount: result.counts.updated,
        unchangedCount: result.counts.unchanged,
        invalidCount: result.counts.invalid,
        results: result.rows,
      })
      .returning({ id: officialUrlImports.id });
    result.importId = row!.id;
  }
  return result;
}

/**
 * 샘플 시험 → 실제 시험 전환. 실제 자료가 처음 승인될 때 호출된다.
 * 샘플 내용(파일·문항·통계·등급컷·단어·듣기·샘플 일정·세부과목 구성)을 지우고 is_sample=false 로 바꾼다.
 * 실제 자료(source_artifact 로 게시된 파일)는 건드리지 않는다.
 */
export async function promoteSampleExam(tx: Tx, examId: string, now: Date): Promise<boolean> {
  const [exam] = await tx.select().from(exams).where(eq(exams.id, examId));
  if (!exam?.isSample) return false;
  await tx
    .delete(examFiles)
    .where(and(eq(examFiles.examId, examId), isNull(examFiles.sourceArtifactId)));
  await tx.delete(questions).where(eq(questions.examId, examId)); // 통계는 cascade
  await tx.delete(gradeCuts).where(eq(gradeCuts.examId, examId));
  await tx.delete(vocabulary).where(eq(vocabulary.examId, examId));
  await tx.delete(listeningTracks).where(eq(listeningTracks.examId, examId));
  await tx
    .delete(examSchedules)
    .where(and(eq(examSchedules.examId, examId), eq(examSchedules.isSample, true)));
  // 세부과목 구성은 실제 입력 자료 기준으로 다시 만든다
  const realCourses = await tx
    .selectDistinct({ courseId: sourceArtifacts.courseId })
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.examId, examId));
  const keep = realCourses.map((c) => c.courseId).filter((c): c is string => Boolean(c));
  const current = await tx.select().from(examCourses).where(eq(examCourses.examId, examId));
  const drop = current.filter((c) => !keep.includes(c.courseId)).map((c) => c.id);
  if (drop.length) await tx.delete(examCourses).where(inArray(examCourses.id, drop));
  await tx.update(exams).set({ isSample: false, updatedAt: now }).where(eq(exams.id, examId));
  return true;
}

/**
 * 관리자 승인: "브라우저에서 공식 URL 을 열어 올바른 PDF/MP3 인지 확인했다"는 확인이 있어야 한다.
 * 승인되면 exam_files 에 delivery_type=redirect 로 게시하고 해당 시험 페이지를 갱신한다.
 */
export async function approveImportedArtifacts(
  ctx: IngestionContext,
  input: { artifactIds: string[]; admin: string; browserChecked: boolean },
): Promise<{ published: number; skipped: Array<{ id: string; reason: string }> }> {
  if (!input.browserChecked)
    throw new IngestionError(
      "NOT_CONFIRMED",
      "공식 URL 을 브라우저에서 열어 확인했다는 체크가 필요합니다",
    );
  const now = ctx.now();
  const skipped: Array<{ id: string; reason: string }> = [];
  const paths = new Set<string>();
  let published = 0;
  for (const id of input.artifactIds) {
    const [a] = await ctx.db.select().from(sourceArtifacts).where(eq(sourceArtifacts.id, id));
    if (!a || !isOperatorImport(a.sourceId)) {
      skipped.push({ id, reason: "운영자 입력 자료가 아닙니다" });
      continue;
    }
    if (a.status !== "manual_review") {
      skipped.push({ id, reason: `상태가 ${a.status} 입니다` });
      continue;
    }
    await ctx.db.transaction(async (tx) => {
      await promoteSampleExam(tx, a.examId, now);
      await tx
        .update(sourceArtifacts)
        .set({
          status: "ready",
          verifiedAt: now,
          verificationMode: "operator_browser",
          finalUrl: a.sourceUrl,
          contentFingerprint: `operator:${a.sourceUrl}`,
          statusReason: `browser-checked and approved by ${input.admin}`,
          lastCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(sourceArtifacts.id, a.id));
    });
    const outcome = await publishSlot(ctx, {
      examId: a.examId,
      subject: a.subject,
      courseId: a.courseId,
      type: a.type,
    });
    if (outcome.published) {
      published += 1;
      for (const p of outcome.examPaths) paths.add(p);
    } else if (outcome.reason !== "already published") {
      skipped.push({ id, reason: outcome.reason });
    }
    await refreshWatchStates(ctx.db, { examId: a.examId, now });
    ctx.logger.info("artifact.published", {
      artifactId: a.id,
      source: a.sourceId,
      approvedBy: input.admin,
      mode: "operator_browser",
    });
  }
  if (paths.size) await ctx.revalidator.revalidatePaths([...paths]);
  return { published, skipped };
}

/** 관리자 거절: 공개하지 않는다 (URL 이 틀렸거나 공식 파일이 아님) */
export async function rejectImportedArtifacts(
  ctx: IngestionContext,
  input: { artifactIds: string[]; admin: string; reason: string },
) {
  let rejected = 0;
  for (const id of input.artifactIds) {
    const rows = await ctx.db
      .update(sourceArtifacts)
      .set({
        status: "failed",
        statusReason: `rejected by ${input.admin}: ${input.reason}`.slice(0, 300),
        updatedAt: ctx.now(),
      })
      .where(
        and(
          eq(sourceArtifacts.id, id),
          eq(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID),
          eq(sourceArtifacts.status, "manual_review"),
        ),
      )
      .returning({ id: sourceArtifacts.id });
    rejected += rows.length;
  }
  return rejected;
}

/** 시험 페이지 경로 (관리자 화면 링크용) */
export function examPagePath(e: { year: number; grade: number; month: number }) {
  return examPath({ year: e.year, grade: e.grade as 1 | 2 | 3, month: e.month });
}
