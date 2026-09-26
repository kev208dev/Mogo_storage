import { and, asc, count, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "../../db/client";
import * as s from "../../db/schema";
import type { Grade, Subject } from "../constants";
import type { ExamKey } from "../exam-path";
import { questionsForSlot } from "./question-slot";
import type { ExamRepository } from "./repository";
import type {
  Course,
  Exam,
  ExamFile,
  ExamSchedule,
  ExamSubject,
  GradeCut,
  ListeningTrack,
  NewReport,
  QuestionWithStats,
  Report,
  VocabularyItem,
} from "./types";

type ExamRow = typeof s.exams.$inferSelect;
type FileRow = typeof s.examFiles.$inferSelect;

const toExam = (row: ExamRow): Exam => ({
  ...row,
  grade: row.grade as Grade,
  academicYear: row.academicYear ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toCourse = (row: typeof s.courses.$inferSelect): Course => ({
  id: row.id,
  code: row.code,
  name: row.name,
  subject: row.subject,
  displayOrder: row.displayOrder,
});

const toFile = (row: FileRow): ExamFile => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class DrizzleExamRepository implements ExamRepository {
  constructor(private readonly db: Database) {}

  async listExams(filter: { year?: number; grade?: Grade } = {}) {
    const conditions = [
      filter.year ? eq(s.exams.year, filter.year) : undefined,
      filter.grade ? eq(s.exams.grade, filter.grade) : undefined,
    ].filter(Boolean);
    const rows = await this.db
      .select()
      .from(s.exams)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(s.exams.year), desc(s.exams.month), desc(s.exams.grade));
    return rows.map(toExam);
  }

  async listRecentExams(limit: number) {
    const rows = await this.db
      .select()
      .from(s.exams)
      .orderBy(desc(s.exams.year), desc(s.exams.month), desc(s.exams.grade))
      .limit(limit);
    return rows.map(toExam);
  }

  async listYears() {
    const rows = await this.db
      .selectDistinct({ year: s.exams.year })
      .from(s.exams)
      .orderBy(desc(s.exams.year));
    return rows.map((r) => r.year);
  }

  async getExam(key: ExamKey) {
    const [row] = await this.db
      .select()
      .from(s.exams)
      .where(
        and(eq(s.exams.year, key.year), eq(s.exams.grade, key.grade), eq(s.exams.month, key.month)),
      )
      .limit(1);
    return row ? toExam(row) : null;
  }

  async getExamById(id: string) {
    const [row] = await this.db.select().from(s.exams).where(eq(s.exams.id, id)).limit(1);
    return row ? toExam(row) : null;
  }

  async listAllExamSubjects(): Promise<ExamSubject[]> {
    return this.db
      .select({
        examId: s.examSubjects.examId,
        subject: s.examSubjects.subject,
        questionCount: s.examSubjects.questionCount,
        totalScore: s.examSubjects.totalScore,
      })
      .from(s.examSubjects);
  }

  async getExamSubjects(examId: string): Promise<ExamSubject[]> {
    return this.db
      .select({
        examId: s.examSubjects.examId,
        subject: s.examSubjects.subject,
        questionCount: s.examSubjects.questionCount,
        totalScore: s.examSubjects.totalScore,
      })
      .from(s.examSubjects)
      .where(eq(s.examSubjects.examId, examId));
  }

  /** 이 시험·영역에서 제공되는 세부과목 (exam_courses ∪ 실제 파일이 있는 course) */
  async getExamCourses(examId: string, subject: Subject): Promise<Course[]> {
    const [declared, fromFiles] = await Promise.all([
      this.db
        .select({ course: s.courses })
        .from(s.examCourses)
        .innerJoin(s.courses, eq(s.courses.id, s.examCourses.courseId))
        .where(and(eq(s.examCourses.examId, examId), eq(s.courses.subject, subject))),
      this.db
        .selectDistinct({ course: s.courses })
        .from(s.examFiles)
        .innerJoin(s.courses, eq(s.courses.id, s.examFiles.courseId))
        .where(and(eq(s.examFiles.examId, examId), eq(s.examFiles.subject, subject))),
    ]);
    const byId = new Map<string, Course>();
    for (const { course } of [...declared, ...fromFiles]) {
      if (!course.active) continue;
      byId.set(course.id, toCourse(course));
    }
    return [...byId.values()].sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async getSubjectDetail(key: ExamKey, subject: Subject, courseCode: string | null = null) {
    const exam = await this.getExam(key);
    if (!exam) return null;
    const subjects = await this.getExamSubjects(exam.id);
    const current = subjects.find((x) => x.subject === subject);
    if (!current) return null;
    const courses = await this.getExamCourses(exam.id, subject);
    const course = courseCode ? (courses.find((c) => c.code === courseCode) ?? null) : null;
    if (courseCode && !course) return null;
    const courseId = course?.id ?? null;
    const courseMatch = <C extends typeof s.examFiles.courseId | typeof s.gradeCuts.courseId>(
      col: C,
    ) => (courseId ? eq(col, courseId) : isNull(col));

    const isEnglish = subject === "english" && !course;
    const [files, questionRows, gradeCutRows, vocabularyRows, trackRows, schedule] =
      await Promise.all([
        this.db
          .select()
          .from(s.examFiles)
          .where(
            and(
              eq(s.examFiles.examId, exam.id),
              eq(s.examFiles.subject, subject),
              courseMatch(s.examFiles.courseId),
            ),
          ),
        this.db.query.questions.findMany({
          where: and(
            eq(s.questions.examId, exam.id),
            eq(s.questions.subject, subject),
            courseId
              ? or(isNull(s.questions.courseId), eq(s.questions.courseId, courseId))
              : isNull(s.questions.courseId),
          ),
          orderBy: asc(s.questions.questionNumber),
          with: {
            statistics: { orderBy: desc(s.questionStatistics.statisticsUpdatedAt), limit: 1 },
          },
        }),
        this.db
          .select()
          .from(s.gradeCuts)
          .where(
            and(
              eq(s.gradeCuts.examId, exam.id),
              eq(s.gradeCuts.subject, subject),
              courseMatch(s.gradeCuts.courseId),
            ),
          ),
        isEnglish
          ? this.db
              .select()
              .from(s.vocabulary)
              .where(and(eq(s.vocabulary.examId, exam.id), eq(s.vocabulary.subject, "english")))
              .orderBy(asc(s.vocabulary.questionNumber), asc(s.vocabulary.word))
          : Promise.resolve([]),
        isEnglish
          ? this.db.query.listeningTracks.findMany({
              where: eq(s.listeningTracks.examId, exam.id),
              with: { transcript: true },
            })
          : Promise.resolve([]),
        this.getSchedule(exam.id),
      ]);

    const questions: QuestionWithStats[] = questionsForSlot(questionRows, courseId).map(
      ({ statistics, createdAt: _c, updatedAt: _u, ...q }) => {
        void _c;
        void _u;
        const st = statistics[0];
        return {
          ...q,
          statistic: st
            ? {
                ...st,
                answerDistribution: st.answerDistribution ?? null,
                statisticsUpdatedAt: st.statisticsUpdatedAt.toISOString(),
              }
            : null,
        };
      },
    );

    const gradeCuts: GradeCut[] = gradeCutRows.map(({ createdAt: _c, ...g }) => {
      void _c;
      return { ...g, updatedAt: g.updatedAt.toISOString() };
    });

    const vocabulary: VocabularyItem[] = vocabularyRows.map((v) => ({
      id: v.id,
      examId: v.examId,
      questionId: v.questionId,
      questionNumber: v.questionNumber,
      word: v.word,
      meaning: v.meaning,
      partOfSpeech: v.partOfSpeech,
      difficulty: Math.min(3, Math.max(1, v.difficulty)) as 1 | 2 | 3,
      createdAt: v.createdAt.toISOString(),
    }));

    const listeningTracks: ListeningTrack[] = trackRows
      .map(({ transcript, ...t }) => ({ ...t, transcript: transcript?.lines ?? null }))
      .sort((a, b) => (a.questionNumber ?? 0) - (b.questionNumber ?? 0));

    const counts = courses.length
      ? await this.db
          .select({ courseId: s.examFiles.courseId, n: count() })
          .from(s.examFiles)
          .where(and(eq(s.examFiles.examId, exam.id), eq(s.examFiles.subject, subject)))
          .groupBy(s.examFiles.courseId)
      : [];
    const courseFileCounts: Record<string, number> = {};
    for (const c of courses)
      courseFileCounts[c.code] = counts.find((x) => x.courseId === c.id)?.n ?? 0;

    // 발견됐지만 아직 게시 전인 공식 자료 (검증 중) → "확인 중" 표시
    const pending = await this.db
      .selectDistinct({ type: s.sourceArtifacts.type })
      .from(s.sourceArtifacts)
      .where(
        and(
          eq(s.sourceArtifacts.examId, exam.id),
          eq(s.sourceArtifacts.subject, subject),
          courseId ? eq(s.sourceArtifacts.courseId, courseId) : isNull(s.sourceArtifacts.courseId),
          inArray(s.sourceArtifacts.status, ["discovered", "verifying", "changed"]),
        ),
      );
    const processingTypes = pending
      .map((p) => p.type)
      .filter((t) => !files.some((f) => f.type === t));

    return {
      exam,
      subjects,
      subject: current,
      courses,
      course,
      courseFileCounts,
      files: files.map(toFile),
      questions,
      gradeCuts,
      vocabulary,
      listeningTracks,
      schedule,
      processingTypes,
    };
  }

  async listExamCoursePaths() {
    const rows = await this.db
      .select({ exam: s.exams, course: s.courses })
      .from(s.examCourses)
      .innerJoin(s.exams, eq(s.exams.id, s.examCourses.examId))
      .innerJoin(s.courses, eq(s.courses.id, s.examCourses.courseId));
    return rows.map((r) => ({ exam: toExam(r.exam), course: toCourse(r.course) }));
  }

  async getSchedule(examId: string): Promise<ExamSchedule | null> {
    const [row] = await this.db
      .select()
      .from(s.examSchedules)
      .where(eq(s.examSchedules.examId, examId))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      grade: row.grade as Grade,
      expectedReleaseStart: row.expectedReleaseStart?.toISOString() ?? null,
      expectedReleaseEnd: row.expectedReleaseEnd?.toISOString() ?? null,
    };
  }

  async getFile(fileId: string) {
    const [row] = await this.db.select().from(s.examFiles).where(eq(s.examFiles.id, fileId));
    return row ? toFile(row) : null;
  }

  async createReport(input: NewReport): Promise<Report> {
    const [row] = await this.db.insert(s.reports).values(input).returning();
    if (!row) throw new Error("Failed to insert report");
    const { ipHash: _ipHash, ...rest } = row;
    void _ipHash;
    return { ...rest, createdAt: row.createdAt.toISOString() };
  }

  async countRecentReports(ipHash: string, since: Date) {
    const [row] = await this.db
      .select({ value: count() })
      .from(s.reports)
      .where(and(eq(s.reports.ipHash, ipHash), gte(s.reports.createdAt, since)));
    return row?.value ?? 0;
  }

  /** 여러 시험의 과목 정보를 한 번에 (sitemap 등) */
  async getSubjectsForExams(examIds: string[]) {
    if (examIds.length === 0) return [];
    return this.db.select().from(s.examSubjects).where(inArray(s.examSubjects.examId, examIds));
  }
}
