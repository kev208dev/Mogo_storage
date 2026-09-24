import type { Subject } from "../constants";
import type { ExamKey } from "../exam-path";
import { sortExamsDesc, type ExamRepository } from "./repository";
import { sampleDataset, type SampleDataset } from "./sample-data";
import type { Exam, NewReport, QuestionWithStats, Report } from "./types";

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

  async getExamSubjects(examId: string) {
    return this.data.examSubjects.filter((s) => s.examId === examId);
  }

  async getSubjectDetail(key: ExamKey, subject: Subject) {
    const exam = await this.getExam(key);
    if (!exam) return null;
    const subjects = await this.getExamSubjects(exam.id);
    const current = subjects.find((s) => s.subject === subject);
    if (!current) return null;

    const inSubject = <T extends { examId: string; subject: Subject }>(rows: T[]) =>
      rows.filter((r) => r.examId === exam.id && r.subject === subject);

    const questions: QuestionWithStats[] = inSubject(this.data.questions)
      .sort((a, b) => a.questionNumber - b.questionNumber)
      .map((q) => ({
        ...q,
        statistic: this.data.statistics.find((s) => s.questionId === q.id) ?? null,
      }));

    return {
      exam,
      subjects,
      subject: current,
      files: inSubject(this.data.files),
      questions,
      gradeCuts: inSubject(this.data.gradeCuts),
      vocabulary:
        subject === "english"
          ? this.data.vocabulary
              .filter((v) => v.examId === exam.id)
              .sort((a, b) => a.questionNumber - b.questionNumber)
          : [],
      listeningTracks:
        subject === "english" ? this.data.listeningTracks.filter((t) => t.examId === exam.id) : [],
      schedule: this.data.schedules.find((s) => s.examId === exam.id) ?? null,
    };
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
