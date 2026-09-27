import { describe, expect, it } from "vitest";
import type { Exam } from "@/lib/data/types";
import { courseByCode } from "@/lib/courses";
import { sampleDataset } from "@/lib/data/sample-data";
import { examPath } from "@/lib/exam-path";
import { buildSitemapEntries } from "@/lib/sitemap-entries";

const SITE = "https://mogo.example";
const toUrl = (path: string) => `${SITE}${path}`;
const real = (e: Exam): Exam => ({ ...e, isSample: false });

describe("sitemap entries", () => {
  const exams = sampleDataset.exams.map(real);
  const input = {
    exams,
    examSubjects: sampleDataset.examSubjects,
    coursePaths: sampleDataset.examCourses.flatMap((ec) => {
      const exam = exams.find((e) => e.id === ec.examId);
      const course = courseByCode(ec.courseId);
      return exam && course ? [{ exam, course }] : [];
    }),
    isIndexable: (e: Exam) => !e.isSample,
    toUrl,
  };

  it("URL 중복 0, 모두 사이트 절대 URL (localhost·preview 없음)", () => {
    const entries = buildSitemapEntries({
      ...input,
      // 같은 세부과목 경로를 두 번 넘겨도 한 번만
      coursePaths: [...input.coursePaths, ...input.coursePaths],
    });
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((u) => u.startsWith(`${SITE}/`) || u === `${SITE}/`)).toBe(true);
    expect(urls.some((u) => /localhost|vercel\.app/.test(u))).toBe(false);
    expect(urls).toContain(`${SITE}/`);
  });

  it("기본 과목(국어) URL 은 넣지 않는다 — 시험 첫 페이지가 canonical", () => {
    const urls = buildSitemapEntries(input).map((e) => e.url);
    expect(urls.some((u) => /\/exam\/\d{4}\/high\d\/\d{2}\/korean$/.test(u))).toBe(false);
    expect(urls.some((u) => /\/exam\/\d{4}\/high\d\/\d{2}$/.test(u))).toBe(true);
  });

  it("noindex(샘플) 시험과 그런 시험만 있는 허브는 제외", () => {
    const sampleOnly = buildSitemapEntries({
      ...input,
      exams: sampleDataset.exams, // isSample=true
      coursePaths: input.coursePaths.map((cp) => ({ ...cp, exam: { ...cp.exam, isSample: true } })),
    });
    expect(sampleOnly.map((e) => e.url)).toEqual([`${SITE}/`]);

    const [first, ...rest] = exams;
    const mixed = buildSitemapEntries({
      ...input,
      exams: [{ ...first!, isSample: true }, ...rest],
    });
    const urls = mixed.map((e) => e.url);
    expect(urls).not.toContain(toUrl(examPath(first!)));
    expect(urls).toContain(toUrl(examPath(rest[0]!)));
  });
});
