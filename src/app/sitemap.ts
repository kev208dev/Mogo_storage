import type { MetadataRoute } from "next";
import { getRepository } from "@/lib/data";
import { shouldNoindexExam } from "@/lib/exam-metadata";
import { absoluteUrl } from "@/lib/site";
import { buildSitemapEntries } from "@/lib/sitemap-entries";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const repo = getRepository();
  const [exams, examSubjects, coursePaths] = await Promise.all([
    repo.listExams(),
    repo.listAllExamSubjects(),
    repo.listExamCoursePaths(),
  ]);
  // noindex 대상(운영의 샘플) 시험과, 그런 시험만 있는 허브는 넣지 않는다
  return buildSitemapEntries({
    exams,
    examSubjects,
    coursePaths,
    isIndexable: (exam) => !shouldNoindexExam(exam),
    toUrl: absoluteUrl,
  });
}
