import Link from "next/link";
import { SUBJECTS, SUBJECT_LABELS, type Subject } from "@/lib/constants";
import type { Exam, ExamSubject } from "@/lib/data/types";
import { examPath } from "@/lib/exam-path";
import { cn } from "@/lib/utils";

/**
 * 과목 선택. 과목별로 독립 URL(/exam/.../english)을 가지므로 링크 기반 내비게이션으로 구현한다.
 * (검색엔진 색인 + 키보드 Tab/Enter 로 이동 가능, JS 불필요)
 */
export function SubjectTabs({
  exam,
  subjects,
  current,
}: {
  exam: Exam;
  subjects: ExamSubject[];
  current: Subject;
}) {
  const available = new Set(subjects.map((s) => s.subject));
  return (
    <nav aria-label="과목 선택">
      <ul className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">
        {SUBJECTS.filter((s) => available.has(s)).map((subject) => {
          const active = subject === current;
          return (
            <li key={subject} className="sm:min-w-20">
              <Link
                href={examPath(exam, subject)}
                aria-current={active ? "page" : undefined}
                scroll={false}
                prefetch
                className={cn(
                  "flex h-11 items-center justify-center rounded-md border px-3 text-[15px] font-bold transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary hover:text-primary",
                )}
              >
                {SUBJECT_LABELS[subject]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
