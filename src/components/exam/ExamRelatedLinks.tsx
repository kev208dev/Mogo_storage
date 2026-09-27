import Link from "next/link";
import { SUBJECT_LABELS, type Subject } from "@/lib/constants";
import { getRepository } from "@/lib/data";
import type { Exam } from "@/lib/data/types";
import { monthAlias } from "@/lib/exam-metadata";
import { examPath, examShortTitle, subjectSegment } from "@/lib/exam-path";

const order = (e: Pick<Exam, "year" | "month">) => e.year * 100 + e.month;

function monthSearchLabel(month: number): string {
  const alias = monthAlias(month);
  return alias ? `${month}월 모고 (${alias})` : `${month}월 모고`;
}

/**
 * 시험 페이지 맨 아래 내부 링크: 이전/다음 시험, 같은 월의 다른 해, 검색 허브.
 * 검색 crawler 와 사용자 탐색을 돕는다. 다운로드보다 위에 두지 않는다.
 */
export async function ExamRelatedLinks({ exam, subject }: { exam: Exam; subject: Subject }) {
  let sameGrade: Exam[];
  try {
    sameGrade = (await getRepository().listExams({ grade: exam.grade })).filter(
      (e) => e.isSample === exam.isSample,
    );
  } catch {
    return null; // 부가 링크 조회 실패가 시험 페이지를 막으면 안 된다
  }
  const sorted = [...sameGrade].sort((a, b) => order(a) - order(b));
  const index = sorted.findIndex((e) => e.id === exam.id);
  const prev = index > 0 ? sorted[index - 1] : undefined;
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : undefined;
  const sameMonth = sorted
    .filter((e) => e.month === exam.month && e.id !== exam.id)
    .sort((a, b) => b.year - a.year)
    .slice(0, 6);
  const linkClass =
    "hover:text-primary inline-flex min-h-11 items-center underline-offset-2 hover:underline";

  return (
    <nav aria-label="관련 시험" className="border-border mt-8 border-t pt-4 text-sm">
      <h2 className="mb-2 font-bold">다른 모의고사</h2>
      <ul className="grid grid-cols-2 gap-x-3">
        <li>
          {prev ? (
            <Link href={examPath(prev)} className={linkClass} rel="prev">
              ← 이전 시험: {examShortTitle(prev)}
            </Link>
          ) : null}
        </li>
        <li className="text-right">
          {next ? (
            <Link href={examPath(next)} className={linkClass} rel="next">
              다음 시험: {examShortTitle(next)} →
            </Link>
          ) : null}
        </li>
      </ul>
      {sameMonth.length ? (
        <>
          <h3 className="text-muted-foreground mt-3 text-xs font-semibold">
            다른 해 고{exam.grade} {exam.month}월
          </h3>
          <ul className="flex flex-wrap gap-x-3">
            {sameMonth.map((e) => (
              <li key={e.id}>
                <Link href={examPath(e)} className={linkClass}>
                  {e.year}년
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="text-muted-foreground mt-3 text-xs font-semibold">모고 모아보기</h3>
      <ul className="flex flex-wrap gap-x-4">
        <li>
          <Link href={`/grade/high${exam.grade}`} className={linkClass}>
            고{exam.grade} 모고 전체
          </Link>
        </li>
        <li>
          <Link href={`/year/${exam.year}`} className={linkClass}>
            {exam.year}년 모의고사 전체
          </Link>
        </li>
        <li>
          <Link href={`/month/${exam.month}`} className={linkClass}>
            {monthSearchLabel(exam.month)} 전체
          </Link>
        </li>
        <li>
          <Link href={`/subject/${subjectSegment(subject)}`} className={linkClass}>
            {SUBJECT_LABELS[subject]} 모고 전체
          </Link>
        </li>
      </ul>
    </nav>
  );
}
