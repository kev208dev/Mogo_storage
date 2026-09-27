import Link from "next/link";
import { and, count, desc, eq } from "drizzle-orm";
import { Panel, SmallButton, formatKst } from "@/components/admin/ui";
import { getDb } from "@/db/client";
import { concepts, courses, exams, questionConcepts, questions } from "@/db/schema";
import { CONCEPT_STATUSES, type ConceptStatus } from "@/lib/concepts";
import { SUBJECT_LABELS } from "@/lib/constants";
import { conceptPath, examCoursePath, examPath, examTitle } from "@/lib/exam-path";
import { AdminNotice } from "../notice";
import { NoDatabase } from "../no-db";
import { renameConceptAction, reviewConceptAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<ConceptStatus, string> = {
  manual_review: "검토 대기",
  approved: "승인",
  rejected: "거절",
};

export default async function ConceptsAdminPage({ searchParams }: PageProps<"/admin/concepts">) {
  const sp = await searchParams;
  const statusParam = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status: ConceptStatus = (CONCEPT_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as ConceptStatus)
    : "manual_review";
  const db = getDb();
  if (!db) return <NoDatabase />;

  const [counts, rows] = await Promise.all([
    db
      .select({ status: questionConcepts.status, n: count() })
      .from(questionConcepts)
      .groupBy(questionConcepts.status),
    db
      .select({
        link: questionConcepts,
        concept: concepts,
        question: questions,
        exam: exams,
        courseCode: courses.code,
        courseName: courses.name,
      })
      .from(questionConcepts)
      .innerJoin(concepts, eq(concepts.id, questionConcepts.conceptId))
      .innerJoin(questions, eq(questions.id, questionConcepts.questionId))
      .innerJoin(exams, eq(exams.id, questions.examId))
      .leftJoin(courses, eq(courses.id, questions.courseId))
      .where(and(eq(questionConcepts.status, status)))
      .orderBy(desc(exams.year), desc(exams.month), questions.subject, questions.questionNumber)
      .limit(300),
  ]);
  const countOf = (s: ConceptStatus) => counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <div className="space-y-4">
      <AdminNotice value={sp.notice} />
      <p className="text-muted-foreground text-sm">
        공식 해설지 문항 머리말에서 규칙으로 만든 개념 태그입니다. 정상 머리말은 자동 승인,
        문장형·흩어진 머리말은 검토 대기로 들어옵니다. 공개 화면에는 승인된 연결만 나옵니다.
      </p>
      <nav aria-label="상태" className="flex flex-wrap gap-1">
        {CONCEPT_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/concepts?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className="border-border aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground rounded-md border px-3 py-1.5 text-sm font-semibold"
          >
            {STATUS_LABELS[s]} {countOf(s)}
          </Link>
        ))}
      </nav>
      <Panel title={`${STATUS_LABELS[status]} (${rows.length}${rows.length === 300 ? "+" : ""})`}>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">항목이 없습니다.</p>
        ) : (
          <ul className="divide-border divide-y" data-testid="concept-review-list">
            {rows.map(({ link, concept, question, exam, courseCode, courseName }) => {
              const key = { year: exam.year, grade: exam.grade as 1 | 2 | 3, month: exam.month };
              const page = courseCode
                ? examCoursePath(key, question.subject, courseCode)
                : examPath(key, question.subject);
              return (
                <li
                  key={`${link.questionId}-${link.conceptId}`}
                  className="space-y-1.5 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`${page}#q-${question.questionNumber}`}
                      className="font-bold underline"
                    >
                      {examTitle(key)} {courseName ?? SUBJECT_LABELS[question.subject]}{" "}
                      {question.questionNumber}번
                    </Link>
                    <span>→</span>
                    <Link
                      href={conceptPath(concept.subject, concept.slug)}
                      className="font-semibold underline"
                    >
                      {concept.name}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      신뢰도 {link.confidence.toFixed(1)} · {link.source}
                      {link.reviewedAt
                        ? ` · ${formatKst(link.reviewedAt)} ${link.reviewedBy ?? ""}`
                        : ""}
                    </span>
                  </div>
                  {link.evidence ? (
                    <p className="text-muted-foreground text-xs">
                      근거: {link.evidence}
                      {link.sourceUrl ? (
                        <>
                          {" · "}
                          <a
                            href={link.sourceUrl}
                            className="underline"
                            rel="noreferrer"
                            target="_blank"
                          >
                            원본 해설지
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {link.reviewReason ? (
                    <p className="text-xs font-semibold">검토 사유: {link.reviewReason}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {link.status !== "approved" ? (
                      <form action={reviewConceptAction}>
                        <input type="hidden" name="questionId" value={link.questionId} />
                        <input type="hidden" name="conceptId" value={link.conceptId} />
                        <input type="hidden" name="decision" value="approved" />
                        <SmallButton variant="primary">승인</SmallButton>
                      </form>
                    ) : null}
                    {link.status !== "rejected" ? (
                      <form action={reviewConceptAction}>
                        <input type="hidden" name="questionId" value={link.questionId} />
                        <input type="hidden" name="conceptId" value={link.conceptId} />
                        <input type="hidden" name="decision" value="rejected" />
                        <SmallButton variant="danger">거절</SmallButton>
                      </form>
                    ) : null}
                    <form action={renameConceptAction} className="flex items-center gap-1">
                      <input type="hidden" name="conceptId" value={concept.id} />
                      <input
                        name="name"
                        defaultValue={concept.name}
                        aria-label={`${concept.name} 이름 수정`}
                        maxLength={40}
                        className="border-border min-h-9 rounded-md border px-2 text-xs"
                      />
                      <SmallButton>이름 수정</SmallButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
