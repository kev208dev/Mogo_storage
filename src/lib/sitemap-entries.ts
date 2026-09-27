import type { MetadataRoute } from "next";
import { DEFAULT_SUBJECT, GRADES, MONTHS, SUBJECTS, type Subject } from "./constants";
import type { Course, Exam, ExamSubject } from "./data/types";
import { examCoursePath, examPath, subjectSegment } from "./exam-path";

export interface SitemapInput {
  exams: Exam[];
  examSubjects: Pick<ExamSubject, "examId" | "subject">[];
  coursePaths: Array<{ exam: Exam; course: Pick<Course, "subject" | "code"> }>;
  /** 검색 노출 가능 여부 (운영의 샘플 시험 = false) */
  isIndexable: (exam: Exam) => boolean;
  /** path → 절대 URL (NEXT_PUBLIC_SITE_URL 기준) */
  toUrl: (path: string) => string;
}

/**
 * sitemap URL 목록. 검색 노출 가능한 시험과, 그런 시험이 하나라도 있는 허브만 넣는다.
 * 같은 URL 은 한 번만 (처음 나온 항목 유지).
 */
export function buildSitemapEntries(input: SitemapInput): MetadataRoute.Sitemap {
  const indexable = input.exams.filter(input.isIndexable);
  const indexableIds = new Set(indexable.map((e) => e.id));
  const subjectsOf = new Map<string, Set<Subject>>();
  for (const row of input.examSubjects) {
    if (!indexableIds.has(row.examId)) continue;
    subjectsOf.set(row.examId, (subjectsOf.get(row.examId) ?? new Set()).add(row.subject));
  }
  const hubSubjects = new Set([...subjectsOf.values()].flatMap((s) => [...s]));
  const hubYears = [...new Set(indexable.map((e) => e.year))].sort((a, b) => b - a);
  const hubMonths = new Set(indexable.map((e) => e.month));
  const hubGrades = new Set<number>(indexable.map((e) => e.grade));

  const entries: MetadataRoute.Sitemap = [
    { url: input.toUrl("/"), changeFrequency: "daily", priority: 1 },
    ...GRADES.filter((g) => hubGrades.has(g)).map((g) => ({
      url: input.toUrl(`/grade/high${g}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...hubYears.map((y) => ({
      url: input.toUrl(`/year/${y}`),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...SUBJECTS.filter((s) => hubSubjects.has(s)).map((s) => ({
      url: input.toUrl(`/subject/${subjectSegment(s)}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...MONTHS.filter((m) => hubMonths.has(m)).map((m) => ({
      url: input.toUrl(`/month/${m}`),
      changeFrequency: "weekly" as const,
      priority: 0.65,
    })),
  ];

  for (const exam of indexable) {
    const lastModified = new Date(exam.updatedAt);
    entries.push({ url: input.toUrl(examPath(exam)), lastModified, priority: 0.9 });
    const subjects = subjectsOf.get(exam.id) ?? new Set<Subject>();
    for (const subject of SUBJECTS) {
      // 기본 과목은 시험 첫 페이지가 canonical (/.../korean 은 redirect)
      if (subject === DEFAULT_SUBJECT || !subjects.has(subject)) continue;
      entries.push({ url: input.toUrl(examPath(exam, subject)), lastModified, priority: 0.8 });
    }
  }
  for (const { exam, course } of input.coursePaths) {
    if (!input.isIndexable(exam)) continue;
    entries.push({
      url: input.toUrl(examCoursePath(exam, course.subject, course.code)),
      lastModified: new Date(exam.updatedAt),
      priority: 0.7,
    });
  }

  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.url) ? false : (seen.add(e.url), true)));
}
