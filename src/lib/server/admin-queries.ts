import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, lte, max } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  examFiles,
  exams,
  examSchedules,
  examSources,
  ingestionErrors,
  ingestionRuns,
  jobs,
  reports,
  sourceArtifacts,
  sourceExams,
  vocabularyCandidates,
} from "@/db/schema";
import { SUBJECTS, type Subject } from "@/lib/constants";

const DAY = 24 * 60 * 60 * 1000;

export type SlotMark = "published" | "pending" | "failed" | "none";

export interface ExamMatrix {
  examId: string;
  label: string;
  schedule: { examDate: string; status: string } | null;
  subjects: Array<{
    subject: Subject;
    question: SlotMark;
    solution: SlotMark;
    listening: SlotMark | null;
  }>;
}

function mark(
  files: Array<{ subject: string; type: string }>,
  artifacts: Array<{ subject: string; type: string; status: string }>,
  subject: string,
  type: string,
): SlotMark {
  if (files.some((f) => f.subject === subject && f.type === type)) return "published";
  const candidates = artifacts.filter((a) => a.subject === subject && a.type === type);
  if (
    candidates.some((a) =>
      ["discovered", "verifying", "ready", "changed", "manual_review"].includes(a.status),
    )
  ) {
    return "pending";
  }
  return candidates.length ? "failed" : "none";
}

export async function examMatrices(db: Database, examIds: string[]): Promise<ExamMatrix[]> {
  if (examIds.length === 0) return [];
  const [examRows, files, artifacts, schedules] = await Promise.all([
    db.select().from(exams).where(inArray(exams.id, examIds)),
    db
      .select({ examId: examFiles.examId, subject: examFiles.subject, type: examFiles.type })
      .from(examFiles)
      .where(inArray(examFiles.examId, examIds)),
    db
      .select({
        examId: sourceArtifacts.examId,
        subject: sourceArtifacts.subject,
        type: sourceArtifacts.type,
        status: sourceArtifacts.status,
      })
      .from(sourceArtifacts)
      .where(inArray(sourceArtifacts.examId, examIds)),
    db.select().from(examSchedules).where(inArray(examSchedules.examId, examIds)),
  ]);
  return examIds
    .map((id) => examRows.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .map((exam) => {
      const f = files.filter((x) => x.examId === exam.id);
      const a = artifacts.filter((x) => x.examId === exam.id);
      const present = SUBJECTS.filter(
        (s) => f.some((x) => x.subject === s) || a.some((x) => x.subject === s),
      );
      const schedule = schedules.find((s) => s.examId === exam.id);
      return {
        examId: exam.id,
        label: `${exam.year} 고${exam.grade} ${exam.month}월`,
        schedule: schedule ? { examDate: schedule.examDate, status: schedule.status } : null,
        subjects: present.map((subject) => ({
          subject,
          question: mark(f, a, subject, "question"),
          solution: mark(f, a, subject, "solution"),
          listening: subject === "english" ? mark(f, a, subject, "listening_audio") : null,
        })),
      };
    });
}

export async function dashboardData(db: Database, now = new Date()) {
  const today = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 14 * DAY + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const [
    sources,
    schedules,
    recentArtifactExams,
    failedJobs,
    failedArtifacts,
    errors24h,
    reviewCount,
    vocabReview,
    pendingReports,
  ] = await Promise.all([
    db.select().from(examSources).orderBy(examSources.id),
    db
      .select()
      .from(examSchedules)
      .where(
        and(
          gte(examSchedules.examDate, new Date(now.getTime() - 3 * DAY).toISOString().slice(0, 10)),
          lte(examSchedules.examDate, soon),
        ),
      )
      .orderBy(examSchedules.examDate),
    // 최근 수집 활동이 있었던 시험 (최근 순 8개)
    db
      .select({ examId: sourceArtifacts.examId, last: max(sourceArtifacts.updatedAt) })
      .from(sourceArtifacts)
      .groupBy(sourceArtifacts.examId)
      .orderBy(desc(max(sourceArtifacts.updatedAt)))
      .limit(8),
    db.select().from(jobs).where(eq(jobs.status, "failed")).orderBy(desc(jobs.updatedAt)).limit(50),
    db
      .select({ artifact: sourceArtifacts, exam: exams })
      .from(sourceArtifacts)
      .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
      .where(inArray(sourceArtifacts.status, ["failed", "unavailable"]))
      .orderBy(desc(sourceArtifacts.updatedAt))
      .limit(50),
    db
      .select({ value: count() })
      .from(ingestionErrors)
      .where(
        and(
          gte(ingestionErrors.createdAt, new Date(now.getTime() - DAY)),
          isNull(ingestionErrors.resolvedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(sourceArtifacts)
      .where(eq(sourceArtifacts.status, "manual_review")),
    db
      .select({ value: count() })
      .from(vocabularyCandidates)
      .where(eq(vocabularyCandidates.status, "needs_review")),
    db.select({ value: count() }).from(reports).where(eq(reports.status, "pending")),
  ]);

  const examIds = [
    ...new Set([
      ...schedules.map((s) => s.examId).filter((id): id is string => Boolean(id)),
      ...recentArtifactExams.map((r) => r.examId),
    ]),
  ];
  return {
    today,
    sources,
    schedules,
    matrices: await examMatrices(db, examIds),
    failedJobs,
    failedArtifacts,
    counts: {
      errors24h: errors24h[0]?.value ?? 0,
      manualReview: reviewCount[0]?.value ?? 0,
      vocabularyReview: vocabReview[0]?.value ?? 0,
      pendingReports: pendingReports[0]?.value ?? 0,
    },
  };
}

export async function reviewData(db: Database) {
  const [artifacts, candidates] = await Promise.all([
    db
      .select({ artifact: sourceArtifacts, exam: exams, source: examSources })
      .from(sourceArtifacts)
      .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
      .innerJoin(examSources, eq(examSources.id, sourceArtifacts.sourceId))
      .where(eq(sourceArtifacts.status, "manual_review"))
      .orderBy(desc(sourceArtifacts.updatedAt))
      .limit(100),
    db
      .select({ candidate: vocabularyCandidates, exam: exams })
      .from(vocabularyCandidates)
      .innerJoin(exams, eq(exams.id, vocabularyCandidates.examId))
      .where(eq(vocabularyCandidates.status, "needs_review"))
      .orderBy(vocabularyCandidates.examId, vocabularyCandidates.questionNumber)
      .limit(200),
  ]);
  return { artifacts, candidates };
}

export async function mappingData(db: Database) {
  return db
    .select({ mapping: sourceExams, exam: exams, source: examSources })
    .from(sourceExams)
    .innerJoin(exams, eq(exams.id, sourceExams.examId))
    .innerJoin(examSources, eq(examSources.id, sourceExams.sourceId))
    .orderBy(desc(sourceExams.lastSeenAt))
    .limit(200);
}

export async function runsData(db: Database) {
  const [runs, errors] = await Promise.all([
    db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(50),
    db.select().from(ingestionErrors).orderBy(desc(ingestionErrors.createdAt)).limit(100),
  ]);
  return { runs, errors };
}

export async function reportsData(db: Database) {
  return db
    .select({ report: reports, exam: exams })
    .from(reports)
    .innerJoin(exams, eq(exams.id, reports.examId))
    .orderBy(desc(reports.createdAt))
    .limit(200);
}
