import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { GRADES } from "@/lib/constants";
import type { Exam } from "@/lib/data/types";
import { examPath, parseGradeSegment } from "@/lib/exam-path";
import { hubExams } from "@/lib/hubs";
import { hubMetadata } from "@/lib/seo";

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return GRADES.map((grade) => ({ grade: `high${grade}` }));
}

export async function generateMetadata({ params }: PageProps<"/grade/[grade]">): Promise<Metadata> {
  const grade = parseGradeSegment((await params).grade);
  if (!grade) return {};
  const { indexable } = await hubExams({ grade });
  return hubMetadata({
    noindex: indexable.length === 0,
    title: `고${grade} 모의고사·모고 모음`,
    description: `고${grade} 역대 모의고사(모고) 문제지와 정답·해설 PDF를 연도·월별로 모아 보고 바로 받으세요.`,
    path: `/grade/high${grade}`,
  });
}

export default async function GradePage({ params }: PageProps<"/grade/[grade]">) {
  const grade = parseGradeSegment((await params).grade);
  if (!grade) notFound();
  const { exams } = await hubExams({ grade });
  const byYear = new Map<number, Exam[]>();
  for (const exam of exams) byYear.set(exam.year, [...(byYear.get(exam.year) ?? []), exam]);

  return (
    <div className="py-6">
      <Breadcrumb
        items={[
          { label: "홈", href: "/" },
          { label: `고${grade}`, href: `/grade/high${grade}` },
        ]}
      />
      <h1 className="mt-2 text-2xl font-bold">고{grade} 모의고사</h1>
      <div className="mt-6 space-y-6">
        {[...byYear.entries()].map(([year, list]) => (
          <section key={year} aria-labelledby={`y-${year}`}>
            <h2 id={`y-${year}`} className="mb-2 font-bold">
              <Link href={`/year/${year}`} className="hover:underline">
                {year}년
              </Link>
            </h2>
            <ul className="flex flex-wrap gap-2">
              {[...list]
                .sort((a, b) => a.month - b.month)
                .map((exam) => (
                  <li key={exam.id}>
                    <Link
                      href={examPath(exam)}
                      className="border-border hover:border-primary hover:text-primary inline-flex min-h-11 min-w-16 items-center justify-center rounded-md border px-3 font-semibold"
                      aria-label={`${year}년 고${grade} ${exam.month}월 모의고사`}
                    >
                      {exam.month}월
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
