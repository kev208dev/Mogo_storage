import "server-only";
import { loadReviewNotes } from "@/ingestion/manual-import/evidence";
import { loadMappingRules, reviewInsights } from "@/ingestion/manual-import/review";
import { and, count, desc, eq, gte, inArray, isNull, lte, max, ne } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  courses,
  examCourses,
  examFiles,
  exams,
  examSchedules,
  examSources,
  ingestionErrors,
  ingestionRuns,
  jobs,
  officialUrlImports,
  reports,
  sourceArtifacts,
  sourceExams,
  vocabularyCandidates,
} from "@/db/schema";
import { SUBJECT_LABELS, SUBJECTS, type Subject } from "@/lib/constants";
import { OPERATOR_IMPORT_SOURCE_ID } from "@/ingestion/manual-import/source";
import { SUBJECT_AREA_LABELS } from "@/lib/courses";

const DAY = 24 * 60 * 60 * 1000;

export type SlotMark = "published" | "pending" | "failed" | "none";

export interface MatrixRow {
  /** 과목 또는 세부과목 이름 (예: "국어", "사회·문화") */
  label: string;
  question: SlotMark;
  solution: SlotMark;
  listening: SlotMark | null;
}

export interface ExamMatrix {
  examId: string;
  label: string;
  schedule: { examDate: string; status: string } | null;
  subjects: Array<{
    subject: Subject;
    /** 세부과목이 있는 영역이면 "사회탐구" 같은 영역 이름 */
    areaLabel: string | null;
    rows: MatrixRow[];
    /** 과목을 확정하지 못한 자료 수 (검토 대기) */
    unresolved: number;
  }>;
}

type Cell = { subject: string; courseId: string | null; type: string };

function mark(
  files: Cell[],
  artifacts: Array<Cell & { status: string; slotKey: string }>,
  subject: string,
  courseId: string | null,
  type: string,
): SlotMark {
  const same = (x: Cell) => x.subject === subject && x.courseId === courseId && x.type === type;
  if (files.some(same)) return "published";
  const candidates = artifacts.filter((a) => same(a) && !a.slotKey.startsWith("unresolved:"));
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
  const [examRows, files, artifacts, schedules, lineups, catalog] = await Promise.all([
    db.select().from(exams).where(inArray(exams.id, examIds)),
    db
      .select({
        examId: examFiles.examId,
        subject: examFiles.subject,
        courseId: examFiles.courseId,
        type: examFiles.type,
      })
      .from(examFiles)
      .where(inArray(examFiles.examId, examIds)),
    db
      .select({
        examId: sourceArtifacts.examId,
        subject: sourceArtifacts.subject,
        courseId: sourceArtifacts.courseId,
        slotKey: sourceArtifacts.slotKey,
        type: sourceArtifacts.type,
        status: sourceArtifacts.status,
      })
      .from(sourceArtifacts)
      .where(inArray(sourceArtifacts.examId, examIds)),
    db.select().from(examSchedules).where(inArray(examSchedules.examId, examIds)),
    db.select().from(examCourses).where(inArray(examCourses.examId, examIds)),
    db.select().from(courses),
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
        subjects: present.map((subject) => {
          const courseIds = new Set([
            ...lineups.filter((l) => l.examId === exam.id).map((l) => l.courseId),
            ...f.filter((x) => x.subject === subject && x.courseId).map((x) => x.courseId!),
            ...a.filter((x) => x.subject === subject && x.courseId).map((x) => x.courseId!),
          ]);
          const subjectCourses = catalog
            .filter((c) => c.subject === subject && courseIds.has(c.id))
            .sort((x, y) => x.displayOrder - y.displayOrder);
          const row = (label: string, courseId: string | null): MatrixRow => ({
            label,
            question: mark(f, a, subject, courseId, "question"),
            solution: mark(f, a, subject, courseId, "solution"),
            listening:
              subject === "english" ? mark(f, a, subject, courseId, "listening_audio") : null,
          });
          const hasSubjectLevel =
            subjectCourses.length === 0 ||
            f.some((x) => x.subject === subject && !x.courseId) ||
            a.some((x) => x.subject === subject && !x.courseId && x.slotKey === "");
          return {
            subject,
            areaLabel: subjectCourses.length
              ? (SUBJECT_AREA_LABELS[subject] ?? SUBJECT_LABELS[subject])
              : null,
            rows: [
              ...(hasSubjectLevel
                ? [row(subjectCourses.length ? "영역 전체" : SUBJECT_LABELS[subject], null)]
                : []),
              ...subjectCourses.map((c) => row(c.name, c.id)),
            ],
            unresolved: a.filter(
              (x) => x.subject === subject && x.slotKey.startsWith("unresolved:"),
            ).length,
          };
        }),
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
      .where(
        and(
          eq(sourceArtifacts.status, "manual_review"),
          // 운영자 입력 공식 URL 은 전용 화면(/admin/imports)에서 브라우저 확인 후 승인한다
          ne(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID),
        ),
      )
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
  // 과목 지정 후보: 영역별 카탈로그 (모호한 표기의 후보를 먼저 보여준다)
  const catalog = await db
    .select()
    .from(courses)
    .where(eq(courses.active, true))
    .orderBy(courses.displayOrder);
  return { artifacts, candidates, catalog };
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

/** 세부과목이 지정된 자료 (잘못 지정된 과목을 고칠 수 있도록) */
export async function courseMappingData(db: Database) {
  const [rows, catalog] = await Promise.all([
    db
      .select({ artifact: sourceArtifacts, exam: exams, source: examSources, course: courses })
      .from(sourceArtifacts)
      .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
      .innerJoin(examSources, eq(examSources.id, sourceArtifacts.sourceId))
      .innerJoin(courses, eq(courses.id, sourceArtifacts.courseId))
      .orderBy(desc(sourceArtifacts.updatedAt))
      .limit(200),
    db.select().from(courses).where(eq(courses.active, true)).orderBy(courses.displayOrder),
  ]);
  return { rows, catalog };
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

/** 운영자 입력 공식 URL: 검토 대기 목록, 상태별 수, 최근 입력 기록 */
export async function importsData(db: Database) {
  const [pending, byStatus, recent] = await Promise.all([
    db
      .select({ artifact: sourceArtifacts, exam: exams, course: courses })
      .from(sourceArtifacts)
      .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
      .leftJoin(courses, eq(courses.id, sourceArtifacts.courseId))
      .where(
        and(
          eq(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID),
          eq(sourceArtifacts.status, "manual_review"),
        ),
      )
      .orderBy(
        desc(exams.year),
        exams.grade,
        exams.month,
        sourceArtifacts.subject,
        sourceArtifacts.slotKey,
        sourceArtifacts.type,
      )
      .limit(500),
    db
      .select({ status: sourceArtifacts.status, n: count() })
      .from(sourceArtifacts)
      .where(eq(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID))
      .groupBy(sourceArtifacts.status),
    db.select().from(officialUrlImports).orderBy(desc(officialUrlImports.createdAt)).limit(5),
  ]);
  const [insights, notes, rules] = await Promise.all([
    reviewInsights(db, pending),
    loadReviewNotes(
      db,
      pending.map((p) => p.artifact.id),
    ),
    loadMappingRules(db),
  ]);
  return { pending, byStatus, recent, insights, notes, rules };
}
