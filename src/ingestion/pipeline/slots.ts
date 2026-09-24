import { eq, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { examFiles } from "../../db/schema";

/**
 * 자료 슬롯 = 시험 + 영역(subject) + 세부과목(course, 없으면 null) + 자료 종류.
 * exam_files 는 course 유무에 따라 partial unique index 가 둘이므로 ON CONFLICT 대상도 나눠야 한다.
 */
export function examFileConflict(courseId: string | null) {
  return courseId
    ? {
        target: [examFiles.examId, examFiles.subject, examFiles.courseId, examFiles.type],
        targetWhere: sql`${examFiles.courseId} is not null`,
      }
    : {
        target: [examFiles.examId, examFiles.subject, examFiles.type],
        targetWhere: sql`${examFiles.courseId} is null`,
      };
}

/** courseId 가 null 이면 IS NULL, 아니면 = 비교 (SQL 에서 NULL = NULL 은 참이 아니므로) */
export function courseIs(column: AnyPgColumn, courseId: string | null): SQL {
  return courseId ? eq(column, courseId) : isNull(column);
}
