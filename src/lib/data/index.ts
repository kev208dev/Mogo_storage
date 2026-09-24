import "server-only";
import { cache } from "react";
import { getDb } from "../../db/client";
import type { Subject } from "../constants";
import type { ExamKey } from "../exam-path";
import { DrizzleExamRepository } from "./drizzle-repository";
import type { ExamRepository } from "./repository";
import { SampleExamRepository } from "./sample-repository";

const globalForRepo = globalThis as unknown as { __mogoRepo?: ExamRepository };

export function getRepository(): ExamRepository {
  if (!globalForRepo.__mogoRepo) {
    const db = getDb();
    globalForRepo.__mogoRepo = db ? new DrizzleExamRepository(db) : new SampleExamRepository();
  }
  return globalForRepo.__mogoRepo;
}

// 한 요청 안에서 generateMetadata 와 page 가 같은 쿼리를 두 번 치지 않도록 React cache 로 감싼다.
export const getExam = cache((year: number, grade: ExamKey["grade"], month: number) =>
  getRepository().getExam({ year, grade, month }),
);

export const getSubjectDetail = cache(
  (year: number, grade: ExamKey["grade"], month: number, subject: Subject) =>
    getRepository().getSubjectDetail({ year, grade, month }, subject),
);

export const getExamSubjects = cache((examId: string) => getRepository().getExamSubjects(examId));
