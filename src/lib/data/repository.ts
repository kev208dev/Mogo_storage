import type { Grade, Subject } from "../constants";
import type { ExamKey } from "../exam-path";
import type { Exam, ExamFile, ExamSubject, ExamSubjectDetail, NewReport, Report } from "./types";

/**
 * 데이터 접근 계층. 화면 코드는 이 인터페이스에만 의존한다.
 * - DATABASE_URL 이 있으면 DrizzleExamRepository
 * - 없으면 SampleExamRepository (in-memory 샘플 데이터)
 */
export interface ExamRepository {
  listExams(filter?: { year?: number; grade?: Grade }): Promise<Exam[]>;
  listRecentExams(limit: number): Promise<Exam[]>;
  listYears(): Promise<number[]>;
  getExam(key: ExamKey): Promise<Exam | null>;
  getExamById(id: string): Promise<Exam | null>;
  getExamSubjects(examId: string): Promise<ExamSubject[]>;
  getSubjectDetail(key: ExamKey, subject: Subject): Promise<ExamSubjectDetail | null>;
  getFile(fileId: string): Promise<ExamFile | null>;
  createReport(report: NewReport): Promise<Report>;
  countRecentReports(ipHash: string, since: Date): Promise<number>;
}

export function sortExamsDesc(a: Exam, b: Exam): number {
  return b.year - a.year || b.month - a.month || b.grade - a.grade;
}
