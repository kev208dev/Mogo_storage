import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { GRADES } from "@/lib/constants";
import { getRepository } from "@/lib/data";
import { examPath, parseYearSegment } from "@/lib/exam-path";
import { hubExams } from "@/lib/hubs";
import { hubMetadata } from "@/lib/seo";

export const revalidate = 3600;

export async function generateStaticParams() {
  const years = await getRepository().listYears();
  return years.map((year) => ({ year: String(year) }));
}

export async function generateMetadata({ params }: PageProps<"/year/[year]">): Promise<Metadata> {
  const year = parseYearSegment((await params).year);
  if (!year) return {};
  const { indexable } = await hubExams({ year });
  return hubMetadata({
    noindex: indexable.length === 0,
    title: `${year}년 모의고사 모음`,
    description: `${year}년 고1·고2·고3 모의고사 문제지와 정답·해설 PDF를 학년·월별로 확인하고 받으세요.`,
    path: `/year/${year}`,
  });
}

export default async function YearPage({ params }: PageProps<"/year/[year]">) {
  const year = parseYearSegment((await params).year);
  if (!year) notFound();
  const { exams } = await hubExams({ year });
  if (exams.length === 0) notFound();

  return (
    <div className="py-6">
      <Breadcrumb
        items={[
          { label: "홈", href: "/" },
          { label: `${year}년`, href: `/year/${year}` },
        ]}
      />
      <h1 className="mt-2 text-2xl font-bold">{year}년 모의고사</h1>
      <div className="mt-6 space-y-6">
        {GRADES.map((grade) => {
          const list = exams.filter((e) => e.grade === grade).sort((a, b) => a.month - b.month);
          if (list.length === 0) return null;
          return (
            <section key={grade} aria-labelledby={`g-${grade}`}>
              <h2 id={`g-${grade}`} className="mb-2 font-bold">
                <Link href={`/grade/high${grade}`} className="hover:underline">
                  고{grade}
                </Link>
              </h2>
              <ul className="flex flex-wrap gap-2">
                {list.map((exam) => (
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
          );
        })}
      </div>
    </div>
  );
}
