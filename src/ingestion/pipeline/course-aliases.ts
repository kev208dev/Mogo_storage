import { eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { courseAliases, courses } from "../../db/schema";
import { COURSE_CATALOG } from "../../lib/courses";
import { normalizeCourseLabel, type CourseAlias } from "../canonical/course";

/** 코드 카탈로그를 DB 에 반영 (새 course 추가 시). 운영자가 비활성화한 값은 유지 */
export async function syncCourseCatalog(db: Database) {
  for (const c of COURSE_CATALOG) {
    await db
      .insert(courses)
      .values({
        id: c.code,
        code: c.code,
        name: c.name,
        subject: c.subject,
        displayOrder: c.displayOrder,
      })
      .onConflictDoUpdate({
        target: courses.code,
        set: { name: c.name, displayOrder: c.displayOrder, updatedAt: new Date() },
      });
  }
}

/** DB 에 저장된 alias (관리자 mapping 포함) */
export async function loadCourseAliases(db: Pick<Database, "select">): Promise<CourseAlias[]> {
  const rows = await db
    .select({ alias: courseAliases.alias, code: courses.code, sourceId: courseAliases.sourceId })
    .from(courseAliases)
    .innerJoin(courses, eq(courses.id, courseAliases.courseId));
  return rows;
}

/**
 * alias 저장 (idempotent). 관리자가 "윤리 → 생활과 윤리" 처럼 확정한 mapping 을 다음 수집에서 재사용한다.
 * sourceId 를 주면 그 source 에만 적용된다 (같은 표기가 source 마다 다른 과목일 수 있으므로 기본은 source 한정).
 */
export async function saveCourseAlias(
  db: Pick<Database, "insert">,
  input: { label: string; courseCode: string; sourceId: string | null; createdBy: string },
) {
  const alias = normalizeCourseLabel(input.label);
  if (!alias) throw new Error("empty alias");
  await db
    .insert(courseAliases)
    .values({
      alias,
      courseId: input.courseCode,
      sourceId: input.sourceId,
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: input.sourceId
        ? [courseAliases.alias, courseAliases.sourceId]
        : [courseAliases.alias],
      targetWhere: input.sourceId
        ? sql`${courseAliases.sourceId} is not null`
        : sql`${courseAliases.sourceId} is null`,
      set: { courseId: input.courseCode, createdBy: input.createdBy },
    });
  return alias;
}

export async function courseIdForCode(
  db: Pick<Database, "select">,
  code: string,
): Promise<string | null> {
  const [row] = await db.select({ id: courses.id }).from(courses).where(eq(courses.code, code));
  return row?.id ?? null;
}
