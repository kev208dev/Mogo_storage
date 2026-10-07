import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  examFiles,
  exams,
  jobs,
  listeningTracks,
  listeningTranscripts,
  studyMaterials,
} from "../../db/schema";
import type { EnglishStudyBackfillFilter } from "./backfill";

/** 영어 PROCESS job 종류 */
const STUDY_JOB_TYPES = [
  "extract_vocabulary",
  "extract_listening_script",
  "generate_study_materials",
  "generate_vocabulary_pdf",
] as const;

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
};

/**
 * 읽기 전용 상태 보고 (운영 DB 검증용): 문항별 대본 출처 · 학습자료 상태 · PROCESS queue.
 * 비밀값은 없다 — URL 은 host 만, 오류는 앞부분만.
 */
export async function englishStudyStatus(db: Database, filter: EnglishStudyBackfillFilter) {
  const where = and(
    filter.year === undefined ? undefined : eq(exams.year, filter.year),
    filter.grade === undefined ? undefined : eq(exams.grade, filter.grade),
    filter.month === undefined ? undefined : eq(exams.month, filter.month),
  );
  const selected = await db
    .select({ id: exams.id, year: exams.year, grade: exams.grade, month: exams.month })
    .from(exams)
    .where(where)
    .orderBy(exams.year, exams.grade, exams.month)
    .limit(50);
  const ids = selected.map((e) => e.id);

  const [transcripts, materials, files, queue, failures] = await Promise.all([
    ids.length
      ? db
          .select({
            examId: listeningTracks.examId,
            questionNumber: listeningTracks.questionNumber,
            timingVerified: listeningTracks.timingVerified,
            origin: listeningTranscripts.origin,
            parserVersion: listeningTranscripts.parserVersion,
            sourceUrl: listeningTranscripts.sourceUrl,
            sourceFileId: listeningTranscripts.sourceFileId,
            lines: listeningTranscripts.lines,
          })
          .from(listeningTranscripts)
          .innerJoin(listeningTracks, eq(listeningTracks.id, listeningTranscripts.trackId))
          .where(inArray(listeningTracks.examId, ids))
          .orderBy(asc(listeningTracks.questionNumber))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            examId: studyMaterials.examId,
            kind: studyMaterials.kind,
            status: studyMaterials.status,
            origin: studyMaterials.origin,
            examFileId: studyMaterials.examFileId,
            storageKey: studyMaterials.storageKey,
          })
          .from(studyMaterials)
          .where(inArray(studyMaterials.examId, ids))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            examId: examFiles.examId,
            type: examFiles.type,
            origin: examFiles.artifactOrigin,
          })
          .from(examFiles)
          .where(and(inArray(examFiles.examId, ids), eq(examFiles.subject, "english")))
      : Promise.resolve([]),
    db
      .select({ type: jobs.type, status: jobs.status, n: count() })
      .from(jobs)
      .where(inArray(jobs.type, [...STUDY_JOB_TYPES]))
      .groupBy(jobs.type, jobs.status),
    db
      .select({
        type: jobs.type,
        status: jobs.status,
        attempts: jobs.attempts,
        lastError: jobs.lastError,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(
        and(inArray(jobs.type, [...STUDY_JOB_TYPES]), inArray(jobs.status, ["failed", "retrying"])),
      )
      .orderBy(desc(jobs.updatedAt))
      .limit(10),
  ]);

  return {
    exams: selected.map((e) => ({
      exam: `${e.year}-g${e.grade}-${String(e.month).padStart(2, "0")}`,
      englishFiles: files
        .filter((f) => f.examId === e.id)
        .map((f) => `${f.type}:${f.origin}`)
        .sort(),
      transcripts: transcripts
        .filter((t) => t.examId === e.id)
        .map((t) => ({
          q: t.questionNumber,
          origin: t.origin,
          parserVersion: t.parserVersion,
          sourceHost: hostOf(t.sourceUrl),
          sourceFileId: t.sourceFileId,
          lines: t.lines.length,
          firstLine: t.lines[0]?.text.slice(0, 40) ?? null,
          lineTimings: t.lines.some((l) => typeof l.startSeconds === "number"),
          timingVerified: t.timingVerified,
        })),
      studyMaterials: materials
        .filter((m) => m.examId === e.id)
        .map((m) => ({
          kind: m.kind,
          status: m.status,
          origin: m.origin,
          published: Boolean(m.examFileId),
          hasFile: Boolean(m.storageKey),
        })),
    })),
    queue,
    recentFailures: failures.map((f) => ({
      type: f.type,
      status: f.status,
      attempts: f.attempts,
      error: f.lastError?.slice(0, 160) ?? null,
      at: f.updatedAt.toISOString(),
    })),
  };
}
