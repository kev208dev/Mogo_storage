"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { courses, examCourses, examFiles, exams, examSubjects, gradeCuts } from "@/db/schema";
import {
  GRADE_CUT_SOURCES,
  SUBJECTS,
  type GradeCutSource,
  type Subject,
} from "@/lib/constants";
import { examCoursePath, examPath } from "@/lib/exam-path";
import {
  GradeCutInputError,
  parseGradeCutEntries,
  parseGradeCutSourceUrl,
} from "@/ingestion/grade-cuts/input";
import { requireAdmin } from "@/lib/server/admin-session";

const PAGE = "/admin/grade-cuts";

function formId(form: FormData, key: string): string {
  const value = String(form.get(key) ?? "").trim();
  if (!/^[\w-]{1,100}$/.test(value)) throw new GradeCutInputError("잘못된 식별자입니다.");
  return value;
}

function parseSubject(form: FormData): Subject {
  const value = String(form.get("subject") ?? "");
  if (!(SUBJECTS as readonly string[]).includes(value))
    throw new GradeCutInputError("과목을 선택하세요.");
  return value as Subject;
}

function parseSource(form: FormData): GradeCutSource {
  const value = String(form.get("source") ?? "");
  if (!(GRADE_CUT_SOURCES as readonly string[]).includes(value))
    throw new GradeCutInputError("출처를 선택하세요.");
  return value as GradeCutSource;
}

async function withNotice(fn: () => Promise<string>) {
  let message: string;
  try {
    message = await fn();
  } catch (error) {
    if (error instanceof GradeCutInputError) message = error.message;
    else throw error;
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?notice=${encodeURIComponent(message)}`);
}

async function revalidateExamSlot(input: {
  year: number;
  grade: number;
  month: number;
  subject: Subject;
  courseCode?: string | null;
}) {
  const key = {
    year: input.year,
    grade: input.grade as 1 | 2 | 3,
    month: input.month,
  };
  revalidatePath(examPath(key));
  revalidatePath(examPath(key, input.subject));
  if (input.courseCode) revalidatePath(examCoursePath(key, input.subject, input.courseCode));
}

export async function upsertGradeCutAction(form: FormData) {
  const admin = await requireAdmin();
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");

  await withNotice(async () => {
    const examId = formId(form, "examId");
    const subject = parseSubject(form);
    const source = parseSource(form);
    const courseIdRaw = String(form.get("courseId") ?? "").trim();
    const courseId = courseIdRaw ? formId(form, "courseId") : null;
    const cuts = parseGradeCutEntries(String(form.get("cuts") ?? ""));
    const sourceUrl = parseGradeCutSourceUrl(String(form.get("sourceUrl") ?? ""));

    const [exam] = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
    if (!exam) throw new GradeCutInputError("시험을 찾을 수 없습니다.");

    const [examSubject] = await db
      .select({ examId: examSubjects.examId })
      .from(examSubjects)
      .where(and(eq(examSubjects.examId, examId), eq(examSubjects.subject, subject)))
      .limit(1);
    if (!examSubject) throw new GradeCutInputError("이 시험에 없는 과목입니다.");

    let course: { id: string; code: string; subject: Subject } | null = null;
    if (courseId) {
      const [row] = await db
        .select({ id: courses.id, code: courses.code, subject: courses.subject })
        .from(courses)
        .where(and(eq(courses.id, courseId), eq(courses.active, true)))
        .limit(1);
      if (!row || row.subject !== subject)
        throw new GradeCutInputError("선택한 세부과목이 영역과 맞지 않습니다.");
      course = row;

      const [declared, published] = await Promise.all([
        db
          .select({ courseId: examCourses.courseId })
          .from(examCourses)
          .where(and(eq(examCourses.examId, examId), eq(examCourses.courseId, courseId)))
          .limit(1),
        db
          .select({ courseId: examFiles.courseId })
          .from(examFiles)
          .where(
            and(
              eq(examFiles.examId, examId),
              eq(examFiles.subject, subject),
              eq(examFiles.courseId, courseId),
            ),
          )
          .limit(1),
      ]);
      if (!declared[0] && !published[0])
        throw new GradeCutInputError("이 시험에 등록되지 않은 세부과목입니다.");
    }

    const slot = and(
      eq(gradeCuts.examId, examId),
      eq(gradeCuts.subject, subject),
      courseId ? eq(gradeCuts.courseId, courseId) : isNull(gradeCuts.courseId),
      eq(gradeCuts.source, source),
    );
    const [existing] = await db.select({ id: gradeCuts.id }).from(gradeCuts).where(slot).limit(1);
    const values = {
      examId,
      subject,
      courseId,
      source,
      sourceUrl,
      isOfficial: source === "official",
      isSample: false,
      cuts,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(gradeCuts).set(values).where(eq(gradeCuts.id, existing.id));
    } else {
      await db.insert(gradeCuts).values(values);
    }

    console.info(
      JSON.stringify({
        event: "admin.action",
        admin,
        action: existing ? "grade_cut.update" : "grade_cut.create",
        target: `${examId}:${subject}:${courseId ?? "-"}:${source}`,
      }),
    );
    await revalidateExamSlot({
      year: exam.year,
      grade: exam.grade,
      month: exam.month,
      subject,
      courseCode: course?.code,
    });
    return `${exam.year} 고${exam.grade} ${exam.month}월 등급컷을 ${existing ? "수정" : "등록"}했습니다.`;
  });
}

export async function deleteGradeCutAction(form: FormData) {
  const admin = await requireAdmin();
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");

  await withNotice(async () => {
    const id = formId(form, "id");
    const [row] = await db
      .select({ cut: gradeCuts, exam: exams, course: courses })
      .from(gradeCuts)
      .innerJoin(exams, eq(exams.id, gradeCuts.examId))
      .leftJoin(courses, eq(courses.id, gradeCuts.courseId))
      .where(eq(gradeCuts.id, id))
      .limit(1);
    if (!row) throw new GradeCutInputError("등급컷을 찾을 수 없습니다.");

    await db.delete(gradeCuts).where(eq(gradeCuts.id, id));
    console.info(
      JSON.stringify({ event: "admin.action", admin, action: "grade_cut.delete", target: id }),
    );
    await revalidateExamSlot({
      year: row.exam.year,
      grade: row.exam.grade,
      month: row.exam.month,
      subject: row.cut.subject,
      courseCode: row.course?.code ?? null,
    });
    return "등급컷을 삭제했습니다.";
  });
}
