import Link from "next/link";
import { SUBJECT_LABELS, type Subject } from "@/lib/constants";
import { SUBJECT_AREA_LABELS } from "@/lib/courses";
import type { Course, Exam } from "@/lib/data/types";
import { examCoursePath } from "@/lib/exam-path";
import { cn } from "@/lib/utils";

/**
 * 세부과목 선택 (사회탐구: 생활과 윤리, 사회·문화 …). 과목마다 독립 URL 을 가진 링크 목록이다.
 * 모바일에서는 2열 그리드로 긴 과목명도 한 번에 보이게 한다.
 */
export function CourseSelector({
  exam,
  subject,
  courses,
  current,
  fileCounts,
}: {
  exam: Exam;
  subject: Subject;
  courses: Course[];
  current: Course | null;
  fileCounts: Record<string, number>;
}) {
  if (courses.length === 0) return null;
  const area = SUBJECT_AREA_LABELS[subject] ?? SUBJECT_LABELS[subject];
  return (
    <nav aria-label={`${area} 세부과목 선택`} className="mt-3">
      <p className="mb-1.5 text-sm font-bold">
        {area} <span className="text-muted-foreground font-normal">과목 선택</span>
      </p>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
        {courses.map((course) => {
          const active = current?.id === course.id;
          const ready = (fileCounts[course.code] ?? 0) > 0;
          return (
            <li key={course.id}>
              <Link
                href={examCoursePath(exam, subject, course.code)}
                aria-current={active ? "page" : undefined}
                scroll={false}
                className={cn(
                  "flex min-h-11 flex-col justify-center rounded-md border px-3 py-1.5 text-sm font-semibold",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary hover:text-primary",
                )}
              >
                {course.name}
                {!ready ? (
                  <span
                    className={cn(
                      "text-[11px] font-normal",
                      active ? "text-primary-foreground/90" : "text-muted-foreground",
                    )}
                  >
                    자료 준비 중
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
