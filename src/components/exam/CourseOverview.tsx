import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  GRADE_CUT_SOURCE_LABELS,
  SUBJECT_LABELS,
  type FileType,
  type Subject,
} from "@/lib/constants";
import { courseAvailability, type CourseSummary } from "@/lib/course-summary";
import { SUBJECT_AREA_LABELS } from "@/lib/courses";
import type { Exam } from "@/lib/data/types";
import { examCoursePath } from "@/lib/exam-path";

type SlotState = "available" | "processing" | "none";

function slotState(summary: CourseSummary, type: FileType): SlotState {
  if (summary.fileTypes.includes(type)) return "available";
  if (summary.processingTypes.includes(type)) return "processing";
  return "none";
}

const STATE_TEXT: Record<SlotState, string> = {
  available: "있음",
  processing: "확인 중",
  none: "없음",
};
const STATE_VARIANT = { available: "success", processing: "warning", none: "neutral" } as const;

/**
 * 영역 페이지(고3 국어/수학, 사회·과학탐구 등)의 세부과목 카드.
 * 영역 전체 자료가 없어도 세부과목 자료가 실제로 있으면 여기서 바로 보이게 한다.
 * "자료 준비 중"은 파일·등급컷·정답·검증 중 자료가 모두 없을 때만 쓴다.
 */
export function CourseOverview({
  exam,
  subject,
  summaries,
}: {
  exam: Exam;
  subject: Subject;
  summaries: CourseSummary[];
}) {
  if (summaries.length === 0) return null;
  const area = SUBJECT_AREA_LABELS[subject] ?? SUBJECT_LABELS[subject];
  const withFiles = summaries.filter((s) => s.fileCount > 0).length;
  return (
    <section
      aria-labelledby="course-overview-heading"
      className="mt-4"
      data-testid="course-overview"
    >
      <h2 id="course-overview-heading" className="text-base font-bold">
        {area} 세부과목별 자료
        <span className="text-muted-foreground ml-1.5 text-sm font-normal">
          {summaries.length}과목 중 {withFiles}과목 자료 공개
        </span>
      </h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {summaries.map((s) => {
          const availability = courseAvailability(s);
          const href = examCoursePath(exam, subject, s.code);
          const providers = s.gradeCuts.map(
            (g) => `${GRADE_CUT_SOURCE_LABELS[g.source]}${g.isOfficial ? "(공식)" : ""}`,
          );
          return (
            <li key={s.code} data-course={s.code} data-availability={availability}>
              <Link
                href={href}
                className="border-border hover:border-primary focus-visible:ring-ring/60 block rounded-md border px-3 py-2.5 focus-visible:ring-[3px] focus-visible:outline-none"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold">{s.name}</span>
                  <span className="text-muted-foreground inline-flex items-center text-xs">
                    {availability === "empty"
                      ? "자료 준비 중"
                      : availability === "processing"
                        ? "공식 자료 확인 중"
                        : `파일 ${s.fileCount}개`}
                    <ChevronRightIcon className="size-4" aria-hidden />
                  </span>
                </span>
                {availability === "empty" ? null : (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {(["question", "solution"] as const).map((type) => {
                      const state = slotState(s, type);
                      return (
                        <Badge key={type} variant={STATE_VARIANT[state]}>
                          {type === "question" ? "문제 PDF" : "해설 PDF"} {STATE_TEXT[state]}
                        </Badge>
                      );
                    })}
                    <Badge variant={s.gradeCuts.length ? "success" : "neutral"}>
                      {s.gradeCuts.length ? `등급컷 ${s.gradeCuts.length}개 출처` : "등급컷 없음"}
                    </Badge>
                    {s.questionCount > 0 ? (
                      <Badge variant="success">웹 정답 {s.questionCount}문항</Badge>
                    ) : null}
                  </span>
                )}
                {providers.length ? (
                  <span className="text-muted-foreground mt-1 block text-xs">
                    등급컷 출처: {providers.join(", ")}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
