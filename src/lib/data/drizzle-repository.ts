import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import * as s from "../../db/schema";
import type { Grade, Subject } from "../constants";
import type { ExamKey } from "../exam-path";
import { questionsForSlot } from "./question-slot";
import type { ExamRepository } from "./repository";
import type {
  ConceptDetail,
  ConceptTag,
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

const toSchedule = (row: typeof s.examSchedules.$inferSelect): ExamSchedule => ({
  ...row,
  grade: row.grade as Grade,
  expectedReleaseStart: row.expectedReleaseStart?.toISOString() ?? null,
  expectedReleaseEnd: row.expectedReleaseEnd?.toISOString() ?? null,
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

  /**
   * 시험·영역(·세부과목) 페이지 데이터. 모든 조회를 한 번에 병렬로 보낸다 (DB 왕복 1회).
   * 시험 id 와 course id 는 subquery 로 풀어서, 앞 조회 결과를 기다리는 순차 왕복을 없앴다.
   */
  async getSubjectDetail(key: ExamKey, subject: Subject, courseCode: string | null = null) {
    // 식별자는 고정 별칭으로 직접 쓴다: relational query(findMany) 안에서는 ${s.exams.id} 같은
    // 컬럼 참조가 바깥 테이블 별칭으로 바뀌어 버린다 (값은 모두 bind parameter)
    const examRef = sql`(select "x_e"."id" from "exams" "x_e" where "x_e"."year" = ${key.year} and "x_e"."grade" = ${key.grade} and "x_e"."month" = ${key.month} limit 1)`;
    const courseRef = courseCode
      ? sql`(select "x_c"."id" from "courses" "x_c" where "x_c"."code" = ${courseCode} limit 1)`
      : null;
    const courseMatch = <C extends typeof s.examFiles.courseId | typeof s.gradeCuts.courseId>(
      col: C,
    ) => (courseRef ? eq(col, courseRef) : isNull(col));
    const isEnglish = subject === "english" && !courseCode;

    const [
      examRows,
      subjects,
      declaredCourses,
      fileCourses,
      files,
      questionRows,
      gradeCutRows,
      vocabularyRows,
      trackRows,
      scheduleRows,
      counts,
      pending,
      conceptRows,
    ] = await Promise.all([
      this.db.select().from(s.exams).where(eq(s.exams.id, examRef)).limit(1),
      this.db
        .select({
          examId: s.examSubjects.examId,
          subject: s.examSubjects.subject,
          questionCount: s.examSubjects.questionCount,
          totalScore: s.examSubjects.totalScore,
        })
        .from(s.examSubjects)
        .where(eq(s.examSubjects.examId, examRef)),
      this.db
        .select({ course: s.courses })
        .from(s.examCourses)
        .innerJoin(s.courses, eq(s.courses.id, s.examCourses.courseId))
        .where(and(eq(s.examCourses.examId, examRef), eq(s.courses.subject, subject))),
      this.db
        .selectDistinct({ course: s.courses })
        .from(s.examFiles)
        .innerJoin(s.courses, eq(s.courses.id, s.examFiles.courseId))
        .where(and(eq(s.examFiles.examId, examRef), eq(s.examFiles.subject, subject))),
      this.db
        .select()
        .from(s.examFiles)
        .where(
          and(
            eq(s.examFiles.examId, examRef),
            eq(s.examFiles.subject, subject),
            courseMatch(s.examFiles.courseId),
          ),
        ),
      this.db.query.questions.findMany({
        where: and(
          eq(s.questions.examId, examRef),
          eq(s.questions.subject, subject),
          courseRef
            ? or(isNull(s.questions.courseId), eq(s.questions.courseId, courseRef))
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
            eq(s.gradeCuts.examId, examRef),
            eq(s.gradeCuts.subject, subject),
            courseMatch(s.gradeCuts.courseId),
          ),
        ),
      isEnglish
        ? this.db
            .select()
            .from(s.vocabulary)
            .where(and(eq(s.vocabulary.examId, examRef), eq(s.vocabulary.subject, "english")))
            .orderBy(asc(s.vocabulary.questionNumber), asc(s.vocabulary.word))
        : Promise.resolve([]),
      isEnglish
        ? this.db.query.listeningTracks.findMany({
            where: eq(s.listeningTracks.examId, examRef),
            with: { transcript: true },
          })
        : Promise.resolve([]),
      this.db.select().from(s.examSchedules).where(eq(s.examSchedules.examId, examRef)).limit(1),
      this.db
        .select({ courseId: s.examFiles.courseId, n: count() })
        .from(s.examFiles)
        .where(and(eq(s.examFiles.examId, examRef), eq(s.examFiles.subject, subject)))
        .groupBy(s.examFiles.courseId),
      // 발견됐지만 아직 게시 전인 공식 자료 (검증 중) → "확인 중" 표시
      this.db
        .selectDistinct({ type: s.sourceArtifacts.type })
        .from(s.sourceArtifacts)
        .where(
          and(
            eq(s.sourceArtifacts.examId, examRef),
            eq(s.sourceArtifacts.subject, subject),
            courseRef
              ? eq(s.sourceArtifacts.courseId, courseRef)
              : isNull(s.sourceArtifacts.courseId),
            inArray(s.sourceArtifacts.status, ["discovered", "verifying", "changed"]),
          ),
        ),
      // 승인된 개념 태그 (문항 필터는 아래 questionsForSlot 결과로)
      this.db
        .select({ questionId: s.questionConcepts.questionId, concept: s.concepts })
        .from(s.questionConcepts)
        .innerJoin(s.concepts, eq(s.concepts.id, s.questionConcepts.conceptId))
        .innerJoin(s.questions, eq(s.questions.id, s.questionConcepts.questionId))
        .where(
          and(
            eq(s.questions.examId, examRef),
            eq(s.questions.subject, subject),
            eq(s.questionConcepts.status, "approved"),
          ),
        )
        .orderBy(asc(s.concepts.name)),
    ]);

    const examRow = examRows[0];
    if (!examRow) return null;
    const exam = toExam(examRow);
    const current = subjects.find((x) => x.subject === subject);
    if (!current) return null;
    const byId = new Map<string, Course>();
    for (const { course } of [...declaredCourses, ...fileCourses]) {
      if (!course.active) continue;
      byId.set(course.id, toCourse(course));
    }
    const courses = [...byId.values()].sort((a, b) => a.displayOrder - b.displayOrder);
    const course = courseCode ? (courses.find((c) => c.code === courseCode) ?? null) : null;
    if (courseCode && !course) return null;
    const courseId = course?.id ?? null;

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

    const conceptTags: Record<string, ConceptTag[]> = {};
    for (const { questionId, concept } of conceptRows) {
      (conceptTags[questionId] ??= []).push({
        subject: concept.subject,
        name: concept.name,
        slug: concept.slug,
      });
    }

    const courseFileCounts: Record<string, number> = {};
    for (const c of courses)
      courseFileCounts[c.code] = counts.find((x) => x.courseId === c.id)?.n ?? 0;

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
      schedule: scheduleRows[0] ? toSchedule(scheduleRows[0]) : null,
      processingTypes,
      conceptTags: Object.fromEntries(
        questions.filter((q) => conceptTags[q.id]).map((q) => [q.id, conceptTags[q.id]!]),
      ),
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

  async getConcept(subject: Subject, slug: string): Promise<ConceptDetail | null> {
    const [concept] = await this.db
      .select()
      .from(s.concepts)
      .where(and(eq(s.concepts.subject, subject), eq(s.concepts.slug, slug)))
      .limit(1);
    if (!concept) return null;
    const rows = await this.db
      .select({
        exam: s.exams,
        question: s.questions,
        course: s.courses,
        evidence: s.questionConcepts.evidence,
      })
      .from(s.questionConcepts)
      .innerJoin(s.questions, eq(s.questions.id, s.questionConcepts.questionId))
      .innerJoin(s.exams, eq(s.exams.id, s.questions.examId))
      .leftJoin(s.courses, eq(s.courses.id, s.questions.courseId))
      .where(
        and(
          eq(s.questionConcepts.conceptId, concept.id),
          eq(s.questionConcepts.status, "approved"),
        ),
      )
      .orderBy(
        desc(s.exams.year),
        desc(s.exams.month),
        desc(s.exams.grade),
        asc(s.questions.questionNumber),
      )
      .limit(500);
    return {
      concept: { subject: concept.subject, name: concept.name, slug: concept.slug },
      questions: rows.map((r) => ({
        exam: toExam(r.exam),
        subject: r.question.subject,
        courseCode: r.course?.code ?? null,
        courseName: r.course?.name ?? null,
        questionNumber: r.question.questionNumber,
        score: r.question.score,
        evidence: r.evidence,
      })),
    };
  }

  async getSchedule(examId: string): Promise<ExamSchedule | null> {
    const [row] = await this.db
      .select()
      .from(s.examSchedules)
      .where(eq(s.examSchedules.examId, examId))
      .limit(1);
    return row ? toSchedule(row) : null;
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
