import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { courses, exams, officialUrlImports, sourceArtifacts } from "@/db/schema";
import { OPERATOR_IMPORT_SOURCE_ID } from "@/ingestion/manual-import/source";
import { loadReviewNotes } from "@/ingestion/manual-import/evidence";
import { loadMappingRules, reviewInsights } from "@/ingestion/manual-import/review";
import type { AdminExamFilter } from "@/lib/admin-exam-filter";
import { requireAdmin } from "./admin-session";
export async function filteredImportsData(db: Database, filter: AdminExamFilter) {
  await requireAdmin();
  const conditions = [
    eq(sourceArtifacts.sourceId, OPERATOR_IMPORT_SOURCE_ID),
    ...(filter.year ? [eq(exams.year, filter.year)] : []),
    ...(filter.month ? [eq(exams.month, filter.month)] : []),
    ...(filter.grade ? [eq(exams.grade, filter.grade)] : []),
  ];
  const [pending, byStatus, recent] = await Promise.all([
    db
      .select({ artifact: sourceArtifacts, exam: exams, course: courses })
      .from(sourceArtifacts)
      .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
      .leftJoin(courses, eq(courses.id, sourceArtifacts.courseId))
      .where(and(...conditions, eq(sourceArtifacts.status, "manual_review")))
      .orderBy(
        desc(exams.year),
        exams.grade,
        exams.month,
        sourceArtifacts.subject,
        sourceArtifacts.slotKey,
        sourceArtifacts.type,
      )
      .limit(500),
    db
      .select({ status: sourceArtifacts.status, n: count() })
      .from(sourceArtifacts)
      .innerJoin(exams, eq(exams.id, sourceArtifacts.examId))
      .where(and(...conditions))
      .groupBy(sourceArtifacts.status),
    db.select().from(officialUrlImports).orderBy(desc(officialUrlImports.createdAt)).limit(5),
  ]);
  const [insights, notes, rules] = await Promise.all([
    reviewInsights(db, pending),
    loadReviewNotes(
      db,
      pending.map((p) => p.artifact.id),
    ),
    loadMappingRules(db),
  ]);
  return { pending, byStatus, recent, insights, notes, rules };
}
