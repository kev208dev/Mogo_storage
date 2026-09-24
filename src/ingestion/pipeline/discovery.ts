import { eq } from "drizzle-orm";
import { examCourses, ingestionErrors, ingestionRuns } from "../../db/schema";
import { dedupeArtifacts } from "../canonical/artifact-type";
import type { IngestionMode } from "../constants";
import type { IngestionContext } from "../context";
import { SourceStructureChangedError, redactUrl, toIngestionError } from "../errors";
import { createAdapter } from "../sources/registry";
import type { DiscoverOptions, DiscoveredExam, ExamLocator, SourceConfig } from "../types";
import { upsertDiscoveredArtifact } from "./artifacts";
import { loadCourseAliases } from "./course-aliases";
import { ensureExamSubjects, examLabel, upsertCanonicalExam, upsertSourceExam } from "./exams";
import { withAdvisoryLock } from "./locks";
import { recordFetchFailure, recordFetchSuccess } from "./sources";

export interface RunCounts {
  discovered: number;
  created: number;
  updated: number;
  failed: number;
}

export interface DiscoveryResult {
  runId: string | null;
  status: "completed" | "partial" | "failed" | "locked";
  counts: RunCounts;
  errors: Array<{ code: string; message: string }>;
}

/**
 * DISCOVER 단계: source 에서 시험/자료를 찾아 DB 에 idempotent 하게 기록하고 VERIFY job 을 만든다.
 * 같은 source 의 discovery 는 advisory lock 으로 동시에 하나만 실행된다.
 * 다운로드/검증/게시는 job queue 에서 따로 처리한다 (한 HTTP 요청에 모든 작업을 몰지 않음).
 */
export async function runDiscovery(
  ctx: IngestionContext,
  input: {
    source: SourceConfig;
    mode: IngestionMode;
    options?: DiscoverOptions;
    /** release watch: 특정 시험만 자료 확인 */
    exams?: ExamLocator[];
    metadata?: Record<string, unknown>;
  },
): Promise<DiscoveryResult> {
  const { db, logger } = ctx;
  const counts: RunCounts = { discovered: 0, created: 0, updated: 0, failed: 0 };
  const errors: DiscoveryResult["errors"] = [];

  const locked = await withAdvisoryLock(db, `ingest:discover:${input.source.id}`, async () => {
    const startedAt = ctx.now();
    const [run] = await db
      .insert(ingestionRuns)
      .values({
        sourceId: input.source.id,
        mode: input.mode,
        startedAt,
        metadata: { ...input.metadata, options: input.options ?? null },
      })
      .returning({ id: ingestionRuns.id });
    const runId = run!.id;
    logger.info("ingestion.started", { runId, source: input.source.id, mode: input.mode });

    const recordError = async (
      error: unknown,
      where: { externalId?: string | null; url?: string | null } = {},
    ) => {
      const e = toIngestionError(error);
      counts.failed += 1;
      errors.push({ code: e.code, message: e.message });
      await db.insert(ingestionErrors).values({
        runId,
        sourceId: input.source.id,
        externalId: where.externalId ?? null,
        url: where.url ? redactUrl(where.url) : null,
        code: e.code,
        message: e.message.slice(0, 1000),
        retryable: e.retryable,
      });
      return e;
    };

    const adapter = createAdapter(input.source, ctx.adapterOptions);
    // 관리자가 확정한 course mapping (예: "윤리" → 생활과 윤리) 을 이번 실행 전체에 적용
    const aliases = await loadCourseAliases(db);
    let fatal: unknown = null;
    try {
      // 1) 시험 목록
      let targets: Array<{ locator: ExamLocator; discovered?: DiscoveredExam }>;
      if (input.exams) {
        targets = input.exams.map((locator) => ({ locator }));
      } else {
        const discovered = await adapter.discoverExams(input.options ?? {});
        targets = discovered.map((d) => ({
          discovered: d,
          locator: { ...d.canonical, externalId: d.externalId, sourceUrl: d.sourceUrl },
        }));
      }

      // 2) 시험별 자료
      for (const target of targets) {
        const { locator, discovered } = target;
        try {
          const canonical = {
            year: locator.year,
            grade: locator.grade,
            month: locator.month,
            examType: locator.examType,
            academicYear: locator.academicYear,
          };
          const examResult = await upsertCanonicalExam(db, canonical, {
            examDate: discovered?.examDate ?? null,
          });
          if (examResult.isSample && process.env.NODE_ENV === "production") {
            throw new SourceStructureChangedError(
              input.source.id,
              `${examLabel(canonical)} collides with a sample exam; refusing to mix sample and real data`,
            );
          }
          let examId = examResult.examId;
          if (discovered) {
            const mapping = await upsertSourceExam(db, {
              sourceId: input.source.id,
              examId,
              discovered,
              now: startedAt,
            });
            examId = mapping.examId; // 관리자가 고정한 mapping 이 있으면 그 시험
            logger.info("exam.discovered", {
              source: input.source.id,
              examId,
              externalId: discovered.externalId,
              created: examResult.created,
            });
          }
          if (examResult.created) counts.created += 1;

          const raw = await adapter.discoverArtifacts(locator);
          const { artifacts, conflicts } = dedupeArtifacts(raw);
          for (const group of conflicts) {
            logger.warn("artifact.manual_review", {
              source: input.source.id,
              examId,
              subject: group[0]!.subject,
              artifactType: group[0]!.type,
              reason: "multiple candidate files for one slot (same course and type)",
              count: group.length,
            });
          }
          await ensureExamSubjects(
            db,
            examId,
            artifacts.map((a) => a.subject),
          );
          for (const artifact of artifacts) {
            counts.discovered += 1;
            const res = await upsertDiscoveredArtifact(db, {
              examId,
              exam: canonical,
              source: input.source,
              artifact,
              now: startedAt,
              aliases,
            });
            if (res.courseId) {
              await db
                .insert(examCourses)
                .values({ examId, courseId: res.courseId })
                .onConflictDoNothing();
            }
            if (res.action === "created") counts.created += 1;
            if (res.action === "url_changed") counts.updated += 1;
            if (res.action !== "unchanged") {
              logger.info(res.action === "created" ? "artifact.discovered" : "artifact.changed", {
                source: input.source.id,
                examId,
                artifactId: res.id,
                subject: artifact.subject,
                course: res.slotKey || null,
                artifactType: artifact.type,
              });
            }
          }
        } catch (error) {
          const e = await recordError(error, {
            externalId: locator.externalId ?? null,
            url: locator.sourceUrl ?? null,
          });
          // 구조 변경은 다른 시험에서도 반복되므로 즉시 중단
          if (e instanceof SourceStructureChangedError || e.code === "SOURCE_STRUCTURE_CHANGED") {
            fatal = e;
            break;
          }
        }
      }
    } catch (error) {
      fatal = await recordError(error);
    }

    const finishedAt = ctx.now();
    const status: DiscoveryResult["status"] = fatal
      ? "failed"
      : counts.failed > 0
        ? "partial"
        : "completed";
    await db
      .update(ingestionRuns)
      .set({
        status,
        finishedAt,
        discoveredCount: counts.discovered,
        createdCount: counts.created,
        updatedCount: counts.updated,
        failedCount: counts.failed,
        errorSummary: errors.length
          ? errors
              .slice(0, 5)
              .map((e) => `${e.code}: ${e.message}`)
              .join("\n")
          : null,
      })
      .where(eq(ingestionRuns.id, runId));

    if (fatal) {
      const e = toIngestionError(fatal);
      const broken = e.code === "SOURCE_STRUCTURE_CHANGED" || e.code === "ROBOTS_DISALLOWED";
      await recordFetchFailure(
        db,
        input.source.id,
        finishedAt,
        broken ? "broken" : "degraded",
        `${e.code}: ${e.message}`,
      );
      logger.error("ingestion.failed", {
        runId,
        source: input.source.id,
        code: e.code,
        message: e.message,
      });
      if (broken) {
        await ctx.notifier.notify({
          kind: "source_broken",
          sourceId: input.source.id,
          message: e.message,
        });
      }
    } else {
      await recordFetchSuccess(db, input.source.id, finishedAt);
      logger.info("ingestion.completed", { runId, source: input.source.id, status, ...counts });
    }
    return { runId, status };
  });

  if (!locked.acquired) {
    logger.info("ingestion.skipped", {
      source: input.source.id,
      reason: "another run holds the lock",
    });
    return { runId: null, status: "locked", counts, errors };
  }
  return { runId: locked.value.runId, status: locked.value.status, counts, errors };
}
