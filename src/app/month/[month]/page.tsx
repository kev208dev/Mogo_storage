import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { GRADES, MONTHS } from "@/lib/constants";
import { monthAlias } from "@/lib/exam-metadata";
import { examPath } from "@/lib/exam-path";
import { hubExams } from "@/lib/hubs";
import { hubMetadata } from "@/lib/seo";

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return MONTHS.map((month) => ({ month: String(month) }));
}

function parseMonth(value: string): number | null {
  const month = Number(value);
  return Number.isInteger(month) && (MONTHS as readonly number[]).includes(month) ? month : null;
}

export async function generateMetadata({ params }: PageProps<"/month/[month]">): Promise<Metadata> {
  const month = parseMonth((await params).month);
  if (!month) return {};
  const alias = monthAlias(month);
  const path = `/month/${month}`;
  const title = `${month}월 모의고사${alias ? `·${alias}` : ""} 모음 - 고1·고2·고3`;
  const description = `역대 ${month}월 고1·고2·고3 모의고사${alias ? `(${alias})` : ""} 문제지와 정답·해설을 연도별로 확인하세요.`;
  const { indexable } = await hubExams({ month });
  return hubMetadata({ title, description, path, noindex: indexable.length === 0 });
}

export default async function MonthPage({ params }: PageProps<"/month/[month]">) {
  const month = parseMonth((await params).month);
  if (!month) notFound();

  const { exams } = await hubExams({ month });
  if (exams.length === 0) notFound();
  const alias = monthAlias(month);
  const path = `/month/${month}`;

  return (
    <div className="py-6">
      <Breadcrumb
        items={[
          { label: "홈", href: "/" },
          { label: `${month}월`, href: path },
        ]}
      />
      <h1 className="mt-2 text-2xl font-extrabold">
        {month}월 모의고사{alias ? ` · ${alias}` : ""} 모음
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        역대 {month}월 고1·고2·고3 모고를 연도별로 찾아 문제지와 정답·해설을 확인할 수 있습니다.
      </p>

      <div className="mt-6 space-y-7">
        {GRADES.map((grade) => {
          const list = exams.filter((exam) => exam.grade === grade);
          if (list.length === 0) return null;
          return (
            <section key={grade} aria-labelledby={`grade-${grade}`}>
              <h2 id={`grade-${grade}`} className="mb-2 text-lg font-bold">
                고{grade} {month}월 모고
              </h2>
              <ul className="divide-border border-border divide-y rounded-md border">
                {list.map((exam) => (
                  <li key={exam.id}>
                    <Link
                      href={examPath(exam)}
                      className="hover:bg-muted flex min-h-12 items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="font-semibold">
                        {exam.year}년 고{grade} {month}월 모의고사
                      </span>
                      <span className="text-muted-foreground text-xs">문제·정답·해설</span>
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
