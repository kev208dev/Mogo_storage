import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { GRADES } from "@/lib/constants";
import { getRepository } from "@/lib/data";
import type { Exam } from "@/lib/data/types";
import { examPath, parseGradeSegment } from "@/lib/exam-path";

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return GRADES.map((grade) => ({ grade: `high${grade}` }));
}

export async function generateMetadata({ params }: PageProps<"/grade/[grade]">): Promise<Metadata> {
  const grade = parseGradeSegment((await params).grade);
  if (!grade) return {};
  const title = `고${grade} 모의고사 모음`;
  return {
    title,
    description: `고${grade} 역대 모의고사 시험지와 정답·해설 PDF를 년도·월별로 모아 보고 바로 다운로드하세요.`,
    alternates: { canonical: `/grade/high${grade}` },
    openGraph: { title, url: `/grade/high${grade}` },
  };
}

export default async function GradePage({ params }: PageProps<"/grade/[grade]">) {
  const grade = parseGradeSegment((await params).grade);
  if (!grade) notFound();
  const exams = await getRepository().listExams({ grade });
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
