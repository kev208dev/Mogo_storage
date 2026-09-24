import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { Exam } from "@/lib/data/types";
import { examPath, examShortTitle } from "@/lib/exam-path";
import { EXAM_TYPE_LABELS } from "@/lib/constants";

/** 간단한 시험 목록 (홈 최근 모의고사, 검색 결과 등) */
export function ExamList({ exams, showType = true }: { exams: Exam[]; showType?: boolean }) {
  if (exams.length === 0) {
    return <p className="text-muted-foreground text-sm">등록된 시험이 없습니다.</p>;
  }
  return (
    <ul className="divide-border border-border divide-y rounded-md border">
      {exams.map((exam) => (
        <li key={exam.id}>
          <Link
            href={examPath(exam)}
            className="hover:bg-muted flex min-h-12 items-center justify-between gap-3 px-3 py-2"
          >
            <span className="font-semibold">{examShortTitle(exam)}</span>
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              {showType ? EXAM_TYPE_LABELS[exam.examType] : null}
              <ChevronRightIcon className="size-4" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
