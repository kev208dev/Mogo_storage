import "server-only";
import { isCapabilityPolicyBlocked } from "@/ingestion/sources/policy";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  courses,
  examCourses,
  examFiles,
  examSchedules,
  exams,
  examSubjects,
  gradeCuts,
  sourceArtifacts,
} from "@/db/schema";
import { requireAdmin } from "./admin-session";
import { OPERATOR_IMPORT_SOURCE_ID } from "@/ingestion/manual-import/source";
import { slotStatus } from "@/lib/admin-coverage-model";
import { SUBJECT_LABELS } from "@/lib/constants";

export async function adminCoverageDetails(db: Database, ids: string[]) {
  await requireAdmin();
  if (!ids.length) return [];
  const [examRows, subjects, lineup, files, artifacts, cuts, schedules] = await Promise.all([
    db
      .select()
      .from(exams)
      .where(and(inArray(exams.id, ids), eq(exams.isSample, false))),
    db.select().from(examSubjects).where(inArray(examSubjects.examId, ids)),
    db
      .select({
        examId: examCourses.examId,
        courseId: courses.id,
        subject: courses.subject,
        name: courses.name,
      })
      .from(examCourses)
      .innerJoin(courses, eq(examCourses.courseId, courses.id))
      .where(inArray(examCourses.examId, ids)),
    db
      .select({
        examId: examFiles.examId,
        subject: examFiles.subject,
        courseId: examFiles.courseId,
        type: examFiles.type,
        name: courses.name,
      })
      .from(examFiles)
      .leftJoin(courses, eq(courses.id, examFiles.courseId))
      .where(inArray(examFiles.examId, ids)),
    db.select().from(sourceArtifacts).where(inArray(sourceArtifacts.examId, ids)),
    db
      .select()
      .from(gradeCuts)
      .where(and(inArray(gradeCuts.examId, ids), eq(gradeCuts.isSample, false))),
    db
      .select()
      .from(examSchedules)
      .where(and(inArray(examSchedules.examId, ids), eq(examSchedules.isSample, false))),
  ]);
  return examRows.map((exam) => {
    const ownFiles = files.filter((f) => f.examId === exam.id);
    const ownArtifacts = artifacts
      .filter((f) => f.examId === exam.id)
      .map((a) => ({ ...a, policyBlocked: isCapabilityPolicyBlocked(a.sourceId, "artifacts") }));
    const named = [...lineup, ...ownFiles.filter((f) => f.courseId)].filter(
      (f) => f.examId === exam.id,
    );
    const slots = new Map<
      string,
      { subject: (typeof subjects)[number]["subject"]; courseId: string | null; name: string }
    >();
    for (const s of subjects.filter((s) => s.examId === exam.id)) {
      if (!named.some((n) => n.subject === s.subject))
        slots.set(s.subject, { ...s, courseId: null, name: SUBJECT_LABELS[s.subject] });
    }
    for (const s of named)
      slots.set(`${s.subject}:${s.courseId}`, {
        ...s,
        name: `${SUBJECT_LABELS[s.subject]} · ${s.name ?? s.courseId}`,
      });
    return {
      exam,
      schedule: schedules.find((s) => s.examId === exam.id),
      pending: ownArtifacts.filter(
        (a) => a.sourceId === OPERATOR_IMPORT_SOURCE_ID && a.status === "manual_review",
      ).length,
      cuts: cuts.filter((c) => c.examId === exam.id),
      slots: [...slots.values()].map((slot) => ({
        ...slot,
        materials: (slot.subject === "english"
          ? ["question", "solution", "listening_audio", "listening_script"]
          : ["question", "solution"]
        ).map((type) => ({ type, ...slotStatus(slot, type, ownFiles, ownArtifacts) })),
      })),
    };
  });
}
