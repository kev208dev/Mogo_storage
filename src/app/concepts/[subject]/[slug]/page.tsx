import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SUBJECT_LABELS } from "@/lib/constants";
import { getRepository } from "@/lib/data";
import {
  conceptPath,
  examCoursePath,
  examPath,
  examTitle,
  parseSubjectSegment,
} from "@/lib/exam-path";

export const revalidate = 3600;

export async function generateStaticParams() {
  // 개념 페이지는 요청 시 생성 (ISR)
  return [];
}

const loadConcept = cache(async (subjectSegment: string, rawSlug: string) => {
  const subject = parseSubjectSegment(subjectSegment);
  if (!subject) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    return null;
  }
  if (slug.length > 120) return null;
  return getRepository().getConcept(subject, slug);
});

export async function generateMetadata({
  params,
}: PageProps<"/concepts/[subject]/[slug]">): Promise<Metadata> {
  const p = await params;
  const detail = await loadConcept(p.subject, p.slug);
  if (!detail) return {};
  const { concept } = detail;
  return {
    title: `${concept.name} — ${SUBJECT_LABELS[concept.subject]} 개념별 기출 문항`,
    description: `${SUBJECT_LABELS[concept.subject]} "${concept.name}" 개념이 나온 모의고사 문항 ${detail.questions.length}개`,
    alternates: { canonical: conceptPath(concept.subject, concept.slug) },
    robots: detail.questions.length ? undefined : { index: false, follow: true },
  };
}

export default async function ConceptPage({ params }: PageProps<"/concepts/[subject]/[slug]">) {
  const p = await params;
  const detail = await loadConcept(p.subject, p.slug);
  if (!detail) notFound();
  const { concept, questions } = detail;

  return (
    <article className="py-6">
      <p className="text-muted-foreground text-sm">{SUBJECT_LABELS[concept.subject]} · 개념</p>
      <h1 className="mt-1 text-2xl font-extrabold">{concept.name}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        공식 정답·해설지의 문항 머리말을 근거로 연결한 문항입니다. 검토를 거친 연결만 보여줍니다.
      </p>
      {questions.length === 0 ? (
        <p className="border-border mt-4 rounded-md border px-3 py-3 text-sm">
          아직 연결된 문항이 없습니다.
        </p>
      ) : (
        <ul
          className="divide-border border-border mt-4 divide-y rounded-md border"
          data-testid="concept-questions"
        >
          {questions.map((q) => {
            const base = q.courseCode
              ? examCoursePath(q.exam, q.subject, q.courseCode)
              : examPath(q.exam, q.subject);
            return (
              <li key={`${q.exam.id}-${q.courseCode ?? ""}-${q.questionNumber}`}>
                <Link
                  href={`${base}#q-${q.questionNumber}`}
                  className="hover:bg-muted flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2"
                >
                  <span className="font-bold">
                    {examTitle(q.exam)} {q.courseName ?? SUBJECT_LABELS[q.subject]}{" "}
                    {q.questionNumber}번
                  </span>
                  <span className="text-muted-foreground text-xs">{q.score}점</span>
                  {q.evidence ? (
                    <span className="text-muted-foreground w-full text-xs">
                      근거: 해설지 머리말 “{q.evidence}”
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
