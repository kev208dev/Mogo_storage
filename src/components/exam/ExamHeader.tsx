import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { Badge } from "@/components/ui/badge";
import { EXAM_TYPE_LABELS, SUBJECT_LABELS, type Subject } from "@/lib/constants";
import type { Exam } from "@/lib/data/types";
import { examPath, examTitle } from "@/lib/exam-path";

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function ExamHeader({
  exam,
  subject,
  extraCrumbs = [],
  heading,
}: {
  exam: Exam;
  subject: Subject;
  /** 영역/세부과목 breadcrumb (예: 사회탐구 > 사회·문화) */
  extraCrumbs?: Array<{ label: string; href: string }>;
  /** 스크린리더용 과목 표기 (기본: 영역 이름) */
  heading?: string;
}) {
  const title = examTitle(exam);
  return (
    <header className="pt-3 pb-3">
      <Breadcrumb
        items={[
          { label: "홈", href: "/" },
          { label: `고${exam.grade}`, href: `/grade/high${exam.grade}` },
          { label: `${exam.year}년`, href: `/year/${exam.year}` },
          { label: `${exam.month}월 모의고사`, href: examPath(exam) },
          ...extraCrumbs,
        ]}
      />
      <h1 className="mt-1 text-[22px] leading-tight font-extrabold tracking-tight sm:text-3xl">
        {title}
        <span className="sr-only"> {heading ?? SUBJECT_LABELS[subject]}</span>
      </h1>
      <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span>
          {EXAM_TYPE_LABELS[exam.examType]} · {exam.organizer}
        </span>
        {exam.examDate ? (
          <span>
            · {exam.examDate} {exam.examDate > todayKst() ? "시행 예정" : "시행"}
          </span>
        ) : null}
        {exam.isSample ? (
          <Badge variant="warning" title="개발용 샘플 데이터입니다">
            샘플
          </Badge>
        ) : null}
      </p>
    </header>
  );
}
