import "server-only";
import type { Grade, Subject } from "./constants";
import { listAllExams, listAllExamSubjectRows } from "./data";
import { sortExamsDesc } from "./data/repository";
import type { Exam } from "./data/types";
import { shouldNoindexExam } from "./exam-metadata";

export interface HubExams {
  exams: Exam[];
  /** 검색에 노출해도 되는 시험 (운영의 샘플 시험 제외). 비어 있으면 허브도 noindex */
  indexable: Exam[];
}

/** 학년·연도·월·과목 허브의 시험 목록. 전체 목록 한 번(요청 단위 cache)에서 걸러낸다 */
export async function hubExams(filter: {
  grade?: Grade;
  year?: number;
  month?: number;
  subject?: Subject;
}): Promise<HubExams> {
  const [all, subjectRows] = await Promise.all([
    listAllExams(),
    filter.subject ? listAllExamSubjectRows() : Promise.resolve([]),
  ]);
  const withSubject = filter.subject
    ? new Set(subjectRows.filter((r) => r.subject === filter.subject).map((r) => r.examId))
    : null;
  const exams = all
    .filter(
      (e) =>
        (filter.grade === undefined || e.grade === filter.grade) &&
        (filter.year === undefined || e.year === filter.year) &&
        (filter.month === undefined || e.month === filter.month) &&
        (!withSubject || withSubject.has(e.id)),
    )
    .sort(sortExamsDesc);
  return { exams, indexable: exams.filter((e) => !shouldNoindexExam(e)) };
}
