import type { MetadataRoute } from "next";
import { DEFAULT_SUBJECT, GRADES, SUBJECTS } from "@/lib/constants";
import { getRepository } from "@/lib/data";
import { shouldNoindexExam } from "@/lib/exam-metadata";
import { examPath } from "@/lib/exam-path";
import { absoluteUrl } from "@/lib/site";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const repo = getRepository();
  const [exams, years] = await Promise.all([repo.listExams(), repo.listYears()]);

  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    ...GRADES.map((g) => ({
      url: absoluteUrl(`/grade/high${g}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...years.map((y) => ({
      url: absoluteUrl(`/year/${y}`),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];

  // noindex 대상(샘플) 시험은 sitemap 에서도 제외한다.
  for (const exam of exams.filter((e) => !shouldNoindexExam(e))) {
    const subjects = await repo.getExamSubjects(exam.id);
    const lastModified = new Date(exam.updatedAt);
    entries.push({ url: absoluteUrl(examPath(exam)), lastModified, priority: 0.9 });
    for (const subject of SUBJECTS) {
      if (subject === DEFAULT_SUBJECT || !subjects.some((s) => s.subject === subject)) continue;
      entries.push({ url: absoluteUrl(examPath(exam, subject)), lastModified, priority: 0.8 });
    }
  }
  return entries;
}
