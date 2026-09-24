import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExamList } from "@/components/exam/ExamList";
import { ExamSearch } from "@/components/search/ExamSearch";
import { GRADES, type Grade } from "@/lib/constants";
import { getRepository, getSubjectDetail } from "@/lib/data";
import { examCoursePath, examPath, examTitle } from "@/lib/exam-path";
import { parseExamQuery, type ParsedExamQuery, type QueryTarget } from "@/lib/exam-query-parser";

export const metadata: Metadata = {
  title: "모의고사 검색",
  robots: { index: false, follow: true },
  alternates: { canonical: "/search" },
};

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toInt(value: string | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null;
  return Number(value);
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const q = first(params.q)?.slice(0, 100) ?? "";

  let parsed: ParsedExamQuery;
  let target: QueryTarget = { subject: null, courseCode: null };
  if (q) {
    const result = parseExamQuery(q);
    parsed = result.ok ? result : result.partial;
    target = { subject: result.subject, courseCode: result.courseCode };
  } else {
    const grade = toInt(first(params.grade));
    parsed = {
      year: toInt(first(params.year)),
      grade:
        grade !== null && (GRADES as readonly number[]).includes(grade) ? (grade as Grade) : null,
      month: toInt(first(params.month)),
    };
  }

  const repo = getRepository();
  const { year, grade, month } = parsed;

  // 년도 없이 "고3 6평" 처럼 학년·월만 → 가장 최근 시험
  let found =
    year !== null && grade !== null && month !== null
      ? await repo.getExam({ year, grade, month })
      : null;
  if (!found && year === null && grade !== null && month !== null) {
    const recent = (await repo.listExams({ grade }))
      .filter((e) => e.month === month && (!e.examDate || e.examDate <= todayKst()))
      .sort((a, b) => b.year - a.year);
    found = recent[0] ?? null;
  }
  if (found) {
    // 과목/세부과목까지 적었으면 그 페이지로 (시험에 실제로 있는 경우만)
    if (target.courseCode && target.subject) {
      const detail = await getSubjectDetail(
        found.year,
        found.grade,
        found.month,
        target.subject,
        target.courseCode,
      );
      if (detail?.course) redirect(examCoursePath(found, target.subject, target.courseCode));
    }
    if (target.subject) {
      const subjects = await repo.getExamSubjects(found.id);
      if (subjects.some((sub) => sub.subject === target.subject))
        redirect(examPath(found, target.subject));
    }
    redirect(examPath(found));
  }

  // 정확한 시험이 없으면: 해석된 조건으로 후보 목록을 보여준다.
  const candidates =
    year !== null || grade !== null
      ? await repo.listExams({ year: year ?? undefined, grade: grade ?? undefined })
      : [];
  const sameMonth = month !== null ? candidates.filter((e) => e.month === month) : [];
  const list = (sameMonth.length ? sameMonth : candidates).slice(0, 30);

  const exact = year !== null && grade !== null && month !== null;

  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="text-xl font-bold">모의고사 검색</h1>
      <ExamSearch defaultQuery={q} className="mt-4" />

      <div className="mt-6" role="status">
        {exact ? (
          <p className="font-semibold">
            {examTitle({ year, grade, month })}는 아직 등록되지 않았습니다.
          </p>
        ) : q || year !== null || grade !== null || month !== null ? (
          <p className="font-semibold">
            검색어를 정확히 이해하지 못했습니다. 년도·학년·월을 함께 입력해 주세요.
          </p>
        ) : (
          <p className="text-muted-foreground">년도·학년·월을 입력해 주세요.</p>
        )}
        <p className="text-muted-foreground mt-1 text-sm">
          예: <code>2025 고2 9월</code>, <code>25 고2 9모</code>, <code>24년 고3 6모</code>
        </p>
      </div>

      {list.length > 0 ? (
        <section aria-labelledby="candidates-title" className="mt-6">
          <h2 id="candidates-title" className="mb-3 text-lg font-bold">
            이런 시험을 찾으셨나요?
          </h2>
          <ExamList exams={list} />
        </section>
      ) : null}
    </div>
  );
}
