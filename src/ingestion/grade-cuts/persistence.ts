import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import {
  courses,
  examCourses,
  exams,
  examSubjects,
  gradeCuts,
  gradeCutSnapshots,
  gradeCutWatchStates,
} from "../../db/schema";
import type { GradeCutSource, Subject } from "../../lib/constants";
import type { GradeCutEntry } from "../../lib/data/types";
import { gradingMode } from "../../lib/grade-cut-mode";
import {
  cutsFingerprint,
  type CollectedGradeCut,
  type WatchExam,
  type WatchSlot,
  type WatchStore,
} from "./core";
import { checkCuts, checkSourceUrl } from "./validate";

export interface CutInput {
  examId: string;
  subject: Subject;
  courseId: string | null;
  source: GradeCutSource;
  sourceUrl: string;
  cuts: GradeCutEntry[];
  observedAt: Date;
  providerStatus?: string;
  providerLabel?: string;
  observedVia?: GradeCutSource | null;
  firstParty?: boolean;
  scoreBasis?: "raw" | "standard";
  parserVersion?: string;
}

function defaultProviderLabel(source: GradeCutSource): string {
  const labels: Record<GradeCutSource, string> = {
    official: "공식",
    megastudy: "메가스터디 예상",
    daesung: "대성 예상",
    ebs: "EBS 예상",
    jongro: "종로학원",
    etoos: "이투스",
    jinhak: "진학사",
    uway: "유웨이",
    kimyoungil: "김영일교육컨설팅",
  };
  return labels[source];
}

/** Current row + immutable history are committed together. Only a genuinely new value writes. */
export async function persistGradeCut(db: Database, input: CutInput): Promise<boolean> {
  const [exam] = await db
    .select({
      year: exams.year,
      grade: exams.grade,
      examType: exams.examType,
      academicYear: exams.academicYear,
    })
    .from(exams)
    .where(eq(exams.id, input.examId))
    .limit(1);
  if (!exam || gradingMode(exam, input.subject) !== "relative")
    throw new Error("fixed or unverified grading mode does not accept grade-cut rows");
  // 만점 초과 · 형식 오류 · 공식 출처 도메인 아님 → 저장하지 않는다 (공식 여부는 출처로만 정함)
  const cuts = checkCuts(input.subject, input.cuts);
  const fingerprint = cutsFingerprint(cuts);
  const url = checkSourceUrl(input.source, input.sourceUrl);
  if (!Number.isFinite(input.observedAt.getTime())) throw new Error("invalid grade cut provenance");
  const providerStatus =
    input.providerStatus ?? (input.source === "official" ? "official_final" : "provider_estimate");
  const providerLabel = input.providerLabel ?? defaultProviderLabel(input.source);
  const observedVia = input.observedVia === undefined ? input.source : input.observedVia;
  const firstParty = input.firstParty ?? true;
  const scoreBasis = input.scoreBasis ?? "raw";
  const parserVersion = input.parserVersion ?? "legacy";
  return db.transaction(async (tx) => {
    const slot = and(
      eq(gradeCuts.examId, input.examId),
      eq(gradeCuts.subject, input.subject),
      input.courseId ? eq(gradeCuts.courseId, input.courseId) : isNull(gradeCuts.courseId),
      eq(gradeCuts.source, input.source),
    );
    let [current] = await tx.select().from(gradeCuts).where(slot).limit(1).for("update");
    const isChanged = (row: typeof current) =>
      !row ||
      cutsFingerprint(row.cuts) !== fingerprint ||
      row.sourceUrl !== url.toString() ||
      row.providerStatus !== providerStatus ||
      row.providerLabel !== providerLabel ||
      row.observedVia !== observedVia ||
      row.firstParty !== firstParty ||
      row.scoreBasis !== scoreBasis ||
      row.parserVersion !== parserVersion;
    let changed = isChanged(current);
    if (!current) {
      const [created] = await tx
        .insert(gradeCuts)
        .values({
          examId: input.examId,
          subject: input.subject,
          courseId: input.courseId,
          source: input.source,
          sourceUrl: url.toString(),
          providerStatus,
          providerLabel,
          observedVia,
          firstParty,
          scoreBasis,
          parserVersion,
          cuts,
          isOfficial: input.source === "official",
          isSample: false,
          updatedAt: input.observedAt,
        })
        .onConflictDoNothing()
        .returning();
      current = created;
      if (!current) {
        [current] = await tx.select().from(gradeCuts).where(slot).limit(1).for("update");
        changed = isChanged(current);
      }
    } else if (changed) {
      await tx
        .update(gradeCuts)
        .set({
          cuts,
          sourceUrl: url.toString(),
          providerStatus,
          providerLabel,
          observedVia,
          firstParty,
          scoreBasis,
          parserVersion,
          isOfficial: input.source === "official",
          isSample: false,
          updatedAt: input.observedAt,
        })
        .where(eq(gradeCuts.id, current.id));
    }
    if (!current) throw new Error("grade cut concurrent insert unavailable");
    if (changed)
      await tx.insert(gradeCutSnapshots).values({
        gradeCutId: current.id,
        examId: input.examId,
        subject: input.subject,
        courseId: input.courseId,
        source: input.source,
        cuts,
        fingerprint,
        sourceUrl: url.toString(),
        providerStatus,
        providerLabel,
        observedVia,
        firstParty,
        scoreBasis,
        parserVersion,
        observedAt: input.observedAt,
      });
    if (input.source === "official") {
      await tx
        .insert(gradeCutWatchStates)
        .values({
          examId: input.examId,
          subject: input.subject,
          courseId: input.courseId,
          slotKey: input.courseId ?? "",
          status: "finalized",
          startedAt: input.observedAt,
          finalizedAt: input.observedAt,
          officialGradeCutId: current.id,
        })
        .onConflictDoUpdate({
          target: [
            gradeCutWatchStates.examId,
            gradeCutWatchStates.subject,
            gradeCutWatchStates.slotKey,
          ],
          set: {
            status: "finalized",
            finalizedAt: input.observedAt,
            officialGradeCutId: current.id,
          },
        });
    }
    return changed;
  });
}

function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function createGradeCutStore(db: Database): WatchStore {
  return {
    async dueExams(now) {
      const today = kstDay(now);
      const bootstrapSince = kstDay(new Date(now.getTime() - 90 * 24 * 3_600_000));
      const rows = await db
        .select()
        .from(exams)
        .where(
          and(
            lte(exams.examDate, today),
            eq(exams.isSample, false),
            or(
              gte(exams.examDate, bootstrapSince),
              sql`exists (select 1 from grade_cut_watch_states w where w.exam_id = ${exams.id} and w.status in ('waiting', 'watching'))`,
            ),
          ),
        );
      return rows
        .filter((e) => e.examDate)
        .map((e) => ({
          id: e.id,
          year: e.year,
          grade: e.grade as 1 | 2 | 3,
          month: e.month,
          examType: e.examType,
          academicYear: e.academicYear,
          examDate: e.examDate!,
        }));
    },
    async slots(exam) {
      const [subjects, details, official] = await Promise.all([
        db
          .select({ subject: examSubjects.subject })
          .from(examSubjects)
          .where(eq(examSubjects.examId, exam.id)),
        db
          .select({ courseId: examCourses.courseId, code: courses.code, subject: courses.subject })
          .from(examCourses)
          .innerJoin(courses, eq(examCourses.courseId, courses.id))
          .where(eq(examCourses.examId, exam.id)),
        db
          .select()
          .from(gradeCuts)
          .where(and(eq(gradeCuts.examId, exam.id), eq(gradeCuts.source, "official"))),
      ]);
      const candidates = [
        ...subjects.map((s) => ({
          subject: s.subject,
          courseId: null as string | null,
          courseCode: null as string | null,
        })),
        ...details.map((d) => ({
          subject: d.subject,
          courseId: d.courseId,
          courseCode: d.code,
        })),
      ].filter((candidate) => gradingMode(exam, candidate.subject) === "relative");
      for (const candidate of candidates) {
        const existing = official.find(
          (o) => o.subject === candidate.subject && o.courseId === candidate.courseId,
        );
        const identity = and(
          eq(gradeCutWatchStates.examId, exam.id),
          eq(gradeCutWatchStates.subject, candidate.subject),
          eq(gradeCutWatchStates.slotKey, candidate.courseId ?? ""),
        );
        await db
          .insert(gradeCutWatchStates)
          .values({
            examId: exam.id,
            subject: candidate.subject,
            courseId: candidate.courseId,
            slotKey: candidate.courseId ?? "",
            status: existing ? "finalized" : "waiting",
            finalizedAt: existing ? existing.updatedAt : null,
            officialGradeCutId: existing?.id ?? null,
          })
          .onConflictDoNothing();

        if (existing) {
          // Self-heal a pre-existing waiting state when an official cut was inserted manually.
          await db
            .update(gradeCutWatchStates)
            .set({
              status: "finalized",
              finalizedAt: existing.updatedAt,
              officialGradeCutId: existing.id,
            })
            .where(identity);
        } else {
          // Deleting/retracting the official row must resume estimates instead of leaving a dead finalized slot.
          await db
            .update(gradeCutWatchStates)
            .set({
              status: "waiting",
              finalizedAt: null,
              officialGradeCutId: null,
              lastPolledAt: null,
            })
            .where(
              and(
                identity,
                eq(gradeCutWatchStates.status, "finalized"),
                isNull(gradeCutWatchStates.officialGradeCutId),
              ),
            );
        }
      }
      const states = await db
        .select()
        .from(gradeCutWatchStates)
        .where(eq(gradeCutWatchStates.examId, exam.id));
      return candidates.map((candidate): WatchSlot => {
        const state = states.find(
          (s) => s.subject === candidate.subject && s.slotKey === (candidate.courseId ?? ""),
        );
        if (!state) throw new Error("missing grade cut watch state");
        return {
          examId: exam.id,
          ...candidate,
          status: state.status as WatchSlot["status"],
          lastPolledAt: state.lastPolledAt,
        };
      });
    },
    async save(exam: WatchExam, slot: WatchSlot, source: GradeCutSource, value: CollectedGradeCut) {
      if (slot.status === "finalized" && source !== "official") return false;
      return persistGradeCut(db, {
        examId: exam.id,
        subject: slot.subject,
        courseId: slot.courseId,
        source,
        sourceUrl: value.sourceUrl,
        cuts: value.cuts,
        observedAt: value.observedAt,
        providerStatus: value.providerStatus,
        providerLabel: value.providerLabel,
        observedVia: value.observedVia,
        firstParty: value.firstParty,
        scoreBasis: value.scoreBasis,
        parserVersion: value.parserVersion,
      });
    },
    async markPolled(slot, now) {
      await db
        .update(gradeCutWatchStates)
        .set({
          lastPolledAt: now,
          // Raw SQL interpolation bypasses Drizzle's timestamp encoder.
          startedAt: sql`coalesce(${gradeCutWatchStates.startedAt}, ${now.toISOString()}::timestamptz)`,
          status: "watching",
        })
        .where(
          and(
            eq(gradeCutWatchStates.examId, slot.examId),
            eq(gradeCutWatchStates.subject, slot.subject),
            eq(gradeCutWatchStates.slotKey, slot.courseId ?? ""),
            ne(gradeCutWatchStates.status, "finalized"),
          ),
        );
    },
    async fail(slot, source, error) {
      const [row] = await db
        .select()
        .from(gradeCutWatchStates)
        .where(
          and(
            eq(gradeCutWatchStates.examId, slot.examId),
            eq(gradeCutWatchStates.subject, slot.subject),
            eq(gradeCutWatchStates.slotKey, slot.courseId ?? ""),
          ),
        )
        .limit(1);
      if (row && row.status !== "finalized")
        await db
          .update(gradeCutWatchStates)
          .set({
            failureCount: sql`${gradeCutWatchStates.failureCount} + 1`,
            lastError: `${source}: ${error instanceof Error ? error.message : String(error)}`.slice(
              0,
              500,
            ),
          })
          .where(eq(gradeCutWatchStates.id, row.id));
    },
  };
}
