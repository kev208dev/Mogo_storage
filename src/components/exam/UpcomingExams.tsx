import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";
import { EXAM_TYPE_LABELS } from "@/lib/constants";
import type { ExamSchedule } from "@/lib/data/types";
import { examPath } from "@/lib/exam-path";
import { formatExamDate } from "./ExamSchedulePanel";

/** 다가오는 시험 — 공식 공지로 확인돼 등록된 일정만 (추측한 날짜는 없다) */
export function UpcomingExams({ schedules }: { schedules: ExamSchedule[] }) {
  return (
    <section aria-labelledby="upcoming-title" className="mt-8" data-testid="upcoming-exams">
      <h2 id="upcoming-title" className="text-lg font-bold">
        다가오는 시험
      </h2>
      {schedules.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-sm">
          공식 공지로 확인된 예정 시험이 아직 없습니다.
        </p>
      ) : (
        <ul className="divide-border border-border mt-2 divide-y rounded-md border">
          {schedules.map((s) => {
            const body = (
              <>
                <CalendarClockIcon className="text-primary size-5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold">
                    {s.year}년 고{s.grade} {s.month}월 {EXAM_TYPE_LABELS[s.examType]}
                    {s.isSample ? (
                      <span className="text-muted-foreground ml-1 text-xs font-normal">
                        (샘플 일정)
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    <time dateTime={s.examDate}>{formatExamDate(s.examDate)}</time> 시행 예정
                  </span>
                </span>
              </>
            );
            return (
              <li key={s.id}>
                {s.examId ? (
                  <Link
                    href={examPath({ year: s.year, grade: s.grade, month: s.month })}
                    className="hover:bg-muted flex min-h-12 items-center gap-3 px-3 py-2"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-12 items-center gap-3 px-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
