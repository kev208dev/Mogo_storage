import type { Grade, Subject } from "../constants";
import type { ExamKey } from "../exam-path";
import type {
  ConceptDetail,
  Course,
  Exam,
  ExamFile,
  ExamSchedule,
  ExamSubject,
  ExamSubjectDetail,
  NewReport,
  Report,
} from "./types";

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
  /** 모든 시험의 영역 (sitemap/정적 생성용, 시험마다 조회하지 않도록 한 번에) */
  listAllExamSubjects(): Promise<ExamSubject[]>;
  /** courseCode 가 있으면 세부과목 페이지 데이터, 없으면 영역 페이지 데이터 */
  getSubjectDetail(
    key: ExamKey,
    subject: Subject,
    courseCode?: string | null,
  ): Promise<ExamSubjectDetail | null>;
  /** 세부과목 페이지 경로 (정적 생성·sitemap 용) */
  listExamCoursePaths(): Promise<Array<{ exam: Exam; course: Course }>>;
  /** 개념 페이지 (승인된 문항만). 없으면 null */
  getConcept(subject: Subject, slug: string): Promise<ConceptDetail | null>;
  getFile(fileId: string): Promise<ExamFile | null>;
  /** 시행일이 from(YYYY-MM-DD, KST) 이후인 확인된 일정 (취소 제외, 가까운 순) */
  listUpcomingSchedules(from: string, limit: number): Promise<ExamSchedule[]>;
  createReport(report: NewReport): Promise<Report>;
  countRecentReports(ipHash: string, since: Date): Promise<number>;
}

export function sortExamsDesc(a: Exam, b: Exam): number {
  return b.year - a.year || b.month - a.month || b.grade - a.grade;
}
