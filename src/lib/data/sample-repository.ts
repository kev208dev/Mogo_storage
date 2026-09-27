import type { Subject } from "../constants";
import { courseByCode } from "../courses";
import type { ExamKey } from "../exam-path";
import { questionsForSlot } from "./question-slot";
import { sortExamsDesc, type ExamRepository } from "./repository";
import { sampleDataset, type SampleDataset } from "./sample-data";
import type { ConceptDetail, Course, Exam, NewReport, QuestionWithStats, Report } from "./types";

function toCourse(code: string): Course | null {
  const c = courseByCode(code);
  return c
    ? { id: c.code, code: c.code, name: c.name, subject: c.subject, displayOrder: c.displayOrder }
    : null;
}

/** DB 없이 개발할 때 쓰는 in-memory 저장소 */
export class SampleExamRepository implements ExamRepository {
  private readonly reports: Array<Report & { ipHash: string | null }> = [];

  constructor(private readonly data: SampleDataset = sampleDataset) {}

  async listExams(filter: { year?: number; grade?: number } = {}) {
    return this.data.exams
      .filter((e) => (filter.year ? e.year === filter.year : true))
      .filter((e) => (filter.grade ? e.grade === filter.grade : true))
      .sort(sortExamsDesc);
  }

  async listRecentExams(limit: number) {
    return [...this.data.exams].sort(sortExamsDesc).slice(0, limit);
  }

  async listYears() {
    return [...new Set(this.data.exams.map((e) => e.year))].sort((a, b) => b - a);
  }

  async getExam(key: ExamKey): Promise<Exam | null> {
    return (
      this.data.exams.find(
        (e) => e.year === key.year && e.grade === key.grade && e.month === key.month,
      ) ?? null
    );
  }

  async getExamById(id: string) {
    return this.data.exams.find((e) => e.id === id) ?? null;
  }

  async listAllExamSubjects() {
    return this.data.examSubjects;
  }

  async getExamSubjects(examId: string) {
    return this.data.examSubjects.filter((s) => s.examId === examId);
  }

  async getSubjectDetail(key: ExamKey, subject: Subject, courseCode: string | null = null) {
    const exam = await this.getExam(key);
    if (!exam) return null;
    const subjects = await this.getExamSubjects(exam.id);
    const current = subjects.find((s) => s.subject === subject);
    if (!current) return null;

    const courseIds = new Set([
      ...this.data.examCourses.filter((c) => c.examId === exam.id).map((c) => c.courseId),
      ...this.data.files.filter((f) => f.examId === exam.id && f.courseId).map((f) => f.courseId!),
    ]);
    const courses = [...courseIds]
      .map(toCourse)
      .filter((c): c is Course => Boolean(c) && c!.subject === subject)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const course = courseCode ? (courses.find((c) => c.code === courseCode) ?? null) : null;
    if (courseCode && !course) return null;
    const courseId = course?.id ?? null;

    const inSlot = <T extends { examId: string; subject: Subject; courseId: string | null }>(
      rows: T[],
    ) =>
      rows.filter((r) => r.examId === exam.id && r.subject === subject && r.courseId === courseId);

    const questions: QuestionWithStats[] = questionsForSlot(
      this.data.questions.filter((q) => q.examId === exam.id && q.subject === subject),
      courseId,
    ).map((q) => ({
      ...q,
      statistic: this.data.statistics.find((s) => s.questionId === q.id) ?? null,
    }));

    const slotCourseIds = new Set(courses.map((c) => c.id));
    const courseFileTypes = [
      ...new Set(
        this.data.files
          .filter(
            (f) =>
              f.examId === exam.id &&
              f.subject === subject &&
              f.courseId !== null &&
              slotCourseIds.has(f.courseId),
          )
          .map((f) => f.type),
      ),
    ];
    const courseFileCounts: Record<string, number> = {};
    for (const c of courses) {
      courseFileCounts[c.code] = this.data.files.filter(
        (f) => f.examId === exam.id && f.subject === subject && f.courseId === c.id,
      ).length;
    }

    return {
      exam,
      subjects,
      subject: current,
      courses,
      course,
      courseFileCounts,
      courseFileTypes,
      processingTypes: [],
      // 샘플 모드에는 개념 태그를 만들지 않는다 (공식 해설지 근거가 없음)
      conceptTags: {},
      files: inSlot(this.data.files),
      questions,
      gradeCuts: inSlot(this.data.gradeCuts),
      vocabulary:
        subject === "english" && !course
          ? this.data.vocabulary
              .filter((v) => v.examId === exam.id)
              .sort((a, b) => a.questionNumber - b.questionNumber)
          : [],
      listeningTracks:
        subject === "english" && !course
          ? this.data.listeningTracks.filter((t) => t.examId === exam.id)
          : [],
      schedule: this.data.schedules.find((s) => s.examId === exam.id) ?? null,
    };
  }

  async listExamCoursePaths() {
    const result: Array<{ exam: Exam; course: Course }> = [];
    for (const ec of this.data.examCourses) {
      const exam = this.data.exams.find((e) => e.id === ec.examId);
      const course = toCourse(ec.courseId);
      if (exam && course) result.push({ exam, course });
    }
    return result;
  }

  async getConcept(): Promise<ConceptDetail | null> {
    return null;
  }

  async getFile(fileId: string) {
    return this.data.files.find((f) => f.id === fileId) ?? null;
  }

  async createReport(input: NewReport): Promise<Report> {
    const report = {
      id: crypto.randomUUID(),
      examId: input.examId,
      fileId: input.fileId,
      subject: input.subject,
      category: input.category,
      message: input.message,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      ipHash: input.ipHash,
    };
    this.reports.push(report);
    // 샘플 모드에서는 서버 로그로만 남긴다.
    console.info("[report:sample]", report.category, report.examId, report.fileId ?? "-");
    const { ipHash: _ipHash, ...publicReport } = report;
    void _ipHash;
    return publicReport;
  }

  async countRecentReports(ipHash: string, since: Date) {
    return this.reports.filter((r) => r.ipHash === ipHash && new Date(r.createdAt) >= since).length;
  }
}
