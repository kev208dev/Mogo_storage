import { CalendarClockIcon, RadarIcon } from "lucide-react";
import type { ExamSchedule } from "@/lib/data/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function formatExamDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}

/**
 * 일정이 확정됐지만 자료가 아직 없는 시험의 안내. (실제 일정이 등록된 시험에만 표시)
 * 다운로드 영역은 그대로 "자료 준비 중"을 보여주고, 이 패널은 상태만 짧게 알려준다.
 */
export function ExamSchedulePanel({ schedule, today }: { schedule: ExamSchedule; today: string }) {
  const upcoming = schedule.examDate > today;
  const watching = schedule.status === "watching" || (!upcoming && schedule.status === "scheduled");
  return (
    <section
      aria-label="시험 일정"
      className="border-primary/30 bg-primary-soft mt-4 flex items-start gap-3 rounded-md border px-3 py-2.5"
    >
      {watching ? (
        <RadarIcon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
      ) : (
        <CalendarClockIcon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
      )}
      <div className="text-sm">
        <p className="text-primary-strong font-bold">
          {upcoming ? "시험 예정" : "시험 시행일"} · {formatExamDate(schedule.examDate)}
          {schedule.isSample ? <span className="ml-1 font-normal">(샘플 일정)</span> : null}
        </p>
        <p className="text-foreground">
          {watching
            ? "공식 자료 공개를 확인하고 있습니다. 공개되는 대로 자동으로 반영됩니다."
            : "시험 자료는 시험 종료 후 업데이트됩니다."}
        </p>
      </div>
    </section>
  );
}
