import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { exams, studyMaterials } from "../../db/schema";
import { READING_NOTE_KIND, STUDY_MATERIAL_ORIGINS } from "../../lib/study";

/**
 * 독해 학습 노트 입력 (data/study/*.json). 운영자가 직접 쓰거나 AI 보조로 만든 짧은 메모만 받는다.
 *  - 지문 전문·긴 인용은 받지 않는다 (항목당 200자 제한 — 저작권이 불분명한 원문 복제 방지)
 *  - 입력은 status=reviewing 으로 들어가고, 관리자 승인 → 게시 후에만 공개된다
 */
const SHORT = z.string().trim().min(1).max(200);
export const readingNoteInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  month: z.number().int().min(1).max(12),
  questionNumber: z.number().int().min(18).max(45),
  origin: z.enum(STUDY_MATERIAL_ORIGINS),
  questionType: z.string().trim().min(1).max(40).optional(),
  keyPoints: z.array(SHORT).max(5).default([]),
  grammarPoints: z.array(SHORT).max(5).default([]),
  answerRationale: SHORT.optional(),
  wrongChoices: z
    .array(z.object({ choice: z.number().int().min(1).max(5), reason: SHORT }))
    .max(4)
    .default([]),
  tags: z.array(z.string().trim().min(1).max(20)).max(8).default([]),
  /** 근거 자료 (공식 PDF URL 등) */
  sources: z
    .array(z.object({ url: z.string().url() }))
    .max(5)
    .default([]),
});
export const readingNoteFileSchema = z.object({ notes: z.array(readingNoteInputSchema) });
export type ReadingNoteInput = z.infer<typeof readingNoteInputSchema>;

export async function importReadingNotes(
  db: Database,
  notes: ReadingNoteInput[],
  opts: { dryRun?: boolean; now?: Date } = {},
) {
  const result = { created: 0, updated: 0, unchanged: 0, missingExam: [] as string[] };
  for (const n of notes) {
    const [exam] = await db
      .select({ id: exams.id })
      .from(exams)
      .where(and(eq(exams.year, n.year), eq(exams.grade, n.grade), eq(exams.month, n.month)));
    if (!exam) {
      result.missingExam.push(`${n.year} 고${n.grade} ${n.month}월`);
      continue;
    }
    const content = {
      questionType: n.questionType ?? null,
      keyPoints: n.keyPoints,
      grammarPoints: n.grammarPoints,
      answerRationale: n.answerRationale ?? null,
      wrongChoices: n.wrongChoices,
      tags: n.tags,
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([n.origin, content]))
      .digest("hex")
      .slice(0, 16);
    const slotKey = String(n.questionNumber);
    const [existing] = await db
      .select()
      .from(studyMaterials)
      .where(
        and(
          eq(studyMaterials.examId, exam.id),
          eq(studyMaterials.subject, "english"),
          eq(studyMaterials.kind, READING_NOTE_KIND),
          eq(studyMaterials.slotKey, slotKey),
        ),
      );
    if (existing?.inputFingerprint === fingerprint) {
      result.unchanged += 1;
      continue;
    }
    if (opts.dryRun) {
      result[existing ? "updated" : "created"] += 1;
      continue;
    }
    const values = {
      examId: exam.id,
      subject: "english" as const,
      kind: READING_NOTE_KIND,
      slotKey,
      questionNumber: n.questionNumber,
      origin: n.origin,
      // 바뀐 내용은 다시 검토한다 (게시된 노트라도 내린 뒤 재승인)
      status: "reviewing" as const,
      title: `${n.year} 고${n.grade} ${n.month}월 영어 ${n.questionNumber}번 독해 노트`,
      content,
      sourceRefs: n.sources.map((s) => ({ kind: "reference", url: s.url, fileId: null })),
      inputFingerprint: fingerprint,
      reviewNote: null,
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: opts.now ?? new Date(),
    };
    await db
      .insert(studyMaterials)
      .values(values)
      .onConflictDoUpdate({
        target: [
          studyMaterials.examId,
          studyMaterials.subject,
          studyMaterials.kind,
          studyMaterials.slotKey,
        ],
        set: values,
      });
    result[existing ? "updated" : "created"] += 1;
  }
  return result;
}
