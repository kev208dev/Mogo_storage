import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { GRADES, SUBJECT_LABELS, SUBJECTS } from "@/lib/constants";
import { getRepository } from "@/lib/data";
import { sortExamsDesc } from "@/lib/data/repository";
import { examPath, parseSubjectSegment, subjectSegment } from "@/lib/exam-path";

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return SUBJECTS.map((subject) => ({ subject: subjectSegment(subject) }));
}

export async function generateMetadata({
  params,
}: PageProps<"/subject/[subject]">): Promise<Metadata> {
  const subject = parseSubjectSegment((await params).subject);
  if (!subject) return {};
  const label = SUBJECT_LABELS[subject];
  const path = `/subject/${subjectSegment(subject)}`;
  const title = `${label} 모의고사·모고 문제지, 정답, 해설`;
  const description = `고1·고2·고3 ${label} 모의고사와 모고를 연도·월별로 모아 문제지, 정답·해설을 빠르게 확인하세요.`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
  };
}

export default async function SubjectPage({ params }: PageProps<"/subject/[subject]">) {
  const subject = parseSubjectSegment((await params).subject);
  if (!subject) notFound();

  const repo = getRepository();
  const [exams, examSubjects] = await Promise.all([repo.listExams(), repo.listAllExamSubjects()]);
  const examIds = new Set(examSubjects.filter((row) => row.subject === subject).map((row) => row.examId));
  const matches = exams.filter((exam) => examIds.has(exam.id)).sort(sortExamsDesc);
  if (matches.length === 0) notFound();

  const label = SUBJECT_LABELS[subject];
  const path = `/subject/${subjectSegment(subject)}`;

  return (
    <div className="py-6">
      <Breadcrumb items={[{ label: "홈", href: "/" }, { label, href: path }]} />
      <h1 className="mt-2 text-2xl font-extrabold">{label} 모의고사·모고 모음</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">
        고1·고2·고3 {label} 모의고사를 연도와 월별로 찾아 문제지, 정답·해설과 학습 기능을
        확인할 수 있습니다.
      </p>

      <div className="mt-6 space-y-7">
        {GRADES.map((grade) => {
          const list = matches.filter((exam) => exam.grade === grade);
          if (list.length === 0) return null;
          return (
            <section key={grade} aria-labelledby={`grade-${grade}`}>
              <h2 id={`grade-${grade}`} className="mb-2 text-lg font-bold">
                고{grade} {label} 모고
              </h2>
              <ul className="divide-border border-border divide-y rounded-md border">
                {list.map((exam) => (
                  <li key={exam.id}>
                    <Link
                      href={examPath(exam, subject)}
                      className="hover:bg-muted flex min-h-12 items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="font-semibold">
                        {exam.year}년 고{grade} {exam.month}월 {label}
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
