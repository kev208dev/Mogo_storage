import type { ExamType, GradeCutSource, Subject } from "../../lib/constants";
import type { GradeCutEntry } from "../../lib/data/types";
import { gradingMode } from "../../lib/grade-cut-mode";
import { dedupeCollected, GradeCutValidationError, validateGradeCut } from "./validate";

export type AdapterStatus =
  "automated_verified" | "degraded" | "disabled_unverified" | "disabled_policy" | "manual_only";
export type WatchStatus = "waiting" | "watching" | "finalized" | "failed";
export interface WatchSlot {
  examId: string;
  subject: Subject;
  courseId: string | null;
  courseCode: string | null;
  status: WatchStatus;
  lastPolledAt: Date | null;
}
export interface WatchExam {
  id: string;
  year: number;
  grade: 1 | 2 | 3;
  month: number;
  examType: ExamType;
  academicYear: number | null;
  examDate: string;
}
export interface CollectedGradeCut {
  subject: Subject;
  courseCode: string | null;
  cuts: GradeCutEntry[];
  sourceUrl: string;
  observedAt: Date;
}
export interface GradeCutAdapter {
  source: GradeCutSource;
  status: AdapterStatus;
  /** Only slots backed by this source's verified public score structure. */
  supports?(exam: WatchExam, slot: WatchSlot): boolean;
  collect(exam: WatchExam, slots: readonly WatchSlot[]): Promise<CollectedGradeCut[]>;
}

/** The same grades in any input order have the same fingerprint. Reject invented or malformed scores. */
export function normalizeCuts(cuts: GradeCutEntry[]): GradeCutEntry[] {
  if (!Array.isArray(cuts) || cuts.length === 0 || cuts.length > 9)
    throw new Error("empty or oversized cuts");
  const sorted = cuts
    .map((cut): GradeCutEntry =>
      cut.rawScore === null
        ? {
            grade: cut.grade,
            rawScore: null,
            rawScoreMin: cut.rawScoreMin,
            rawScoreMax: cut.rawScoreMax,
          }
        : { grade: cut.grade, rawScore: cut.rawScore },
    )
    .sort((a, b) => a.grade - b.grade);
  for (let i = 0; i < sorted.length; i++) {
    const cut = sorted[i]!;
    const low = cut.rawScore === null ? cut.rawScoreMin : cut.rawScore;
    const high = cut.rawScore === null ? cut.rawScoreMax : cut.rawScore;
    const previous = sorted[i - 1];
    const previousLow = previous?.rawScore === null ? previous.rawScoreMin : previous?.rawScore;
    if (
      !Number.isInteger(cut.grade) ||
      cut.grade < 1 ||
      cut.grade > 9 ||
      !Number.isInteger(low) ||
      !Number.isInteger(high) ||
      low < 0 ||
      high > 100 ||
      low > high ||
      (previous && (cut.grade === previous.grade || high > previousLow!))
    )
      throw new Error("invalid grade cut");
  }
  return sorted;
}
export function cutsFingerprint(cuts: GradeCutEntry[]): string {
  return normalizeCuts(cuts)
    .map((cut) =>
      cut.rawScore === null
        ? `${cut.grade}:${cut.rawScoreMin}~${cut.rawScoreMax}`
        : `${cut.grade}:${cut.rawScore}`,
    )
    .join("|");
}
export function slotKey(slot: Pick<WatchSlot, "subject" | "courseCode">): string {
  return `${slot.subject}:${slot.courseCode ?? ""}`;
}

/** Conservative KST fallback, kept by exam type for future schedule-specific end metadata. */
export function examEndAt(exam: WatchExam): Date {
  const time =
    exam.examType === "csat" ? "18:00" : exam.examType === "kice_mock" ? "17:30" : "17:00";
  return new Date(`${exam.examDate}T${time}:00+09:00`);
}
export const POLL_INTERVAL_MS = 5 * 60_000;
export function isGradeCutDue(exam: WatchExam, slot: WatchSlot, now: Date): boolean {
  const elapsed = now.getTime() - examEndAt(exam).getTime();
  return (
    slot.status !== "finalized" &&
    slot.status !== "failed" &&
    elapsed >= 0 &&
    (!slot.lastPolledAt || now.getTime() - slot.lastPolledAt.getTime() >= POLL_INTERVAL_MS)
  );
}

export interface WatchStore {
  dueExams(now: Date): Promise<WatchExam[]>;
  slots(exam: WatchExam): Promise<WatchSlot[]>;
  save(
    exam: WatchExam,
    slot: WatchSlot,
    source: GradeCutSource,
    value: CollectedGradeCut,
  ): Promise<boolean>;
  markPolled(slot: WatchSlot, now: Date): Promise<void>;
  fail(slot: WatchSlot, source: GradeCutSource, error: unknown): Promise<void>;
}
export interface WatchResult {
  changed: number;
  failures: number;
  polled: number;
}
export interface WatchSourceEvent {
  examId: string;
  source: GradeCutSource;
  requested: number;
  collected: number;
  changed: number;
  finalized: number;
  /** 검증 실패(만점 초과 · 출처 도메인 불일치 · 관측 시각 등)나 같은 슬롯 모순으로 버린 값 */
  rejected: number;
  failed: boolean;
  durationMs: number;
}
export type WatchStage =
  | "due_exams"
  | "load_slots"
  | "adapter_collect"
  | "source_failure"
  | "reject_cut"
  | "persist_cut"
  | "revalidate"
  | "source_event"
  | "mark_polled";
export interface WatchProgress {
  stage: WatchStage;
  exam?: string;
  subject?: Subject;
  course?: string | null;
  reason?: string;
}

/** Adapter errors are isolated; persistence errors still surface so a broken DB is visible to operations. */
export async function runGradeCutWatch(
  store: WatchStore,
  adapters: readonly GradeCutAdapter[],
  now: Date,
  revalidate: (exam: WatchExam, slot: WatchSlot) => Promise<void> = async () => {},
  onSource?: (event: WatchSourceEvent) => void,
  onProgress?: (progress: WatchProgress) => void,
): Promise<WatchResult> {
  const result: WatchResult = { changed: 0, failures: 0, polled: 0 };
  onProgress?.({ stage: "due_exams" });
  for (const exam of await store.dueExams(now)) {
    if (now < examEndAt(exam)) continue;
    onProgress?.({ stage: "load_slots", exam: exam.id });
    const slots = (await store.slots(exam)).filter(
      (slot) => gradingMode(exam, slot.subject) === "relative" && isGradeCutDue(exam, slot, now),
    );
    if (!slots.length) continue;
    // Official sources run first, then finalized slots are removed before estimated adapters run.
    const verified = adapters
      .filter((a) => a.status === "automated_verified")
      .sort((a, b) => Number(b.source === "official") - Number(a.source === "official"));
    // Do not make a watch state look "polled" when no verified source was actually called.
    if (!verified.length) continue;

    const active = new Map(slots.map((slot) => [slotKey(slot), slot]));
    const polled = new Set<string>();
    for (const adapter of verified) {
      const requested = [...active.values()].filter(
        (slot) => adapter.supports?.(exam, slot) ?? true,
      );
      if (!requested.length) continue;
      const started = Date.now();
      let collected: CollectedGradeCut[];
      try {
        onProgress?.({ stage: "adapter_collect", exam: exam.id });
        collected = await adapter.collect(exam, requested);
      } catch (error) {
        result.failures++;
        for (const slot of requested) {
          onProgress?.({
            stage: "source_failure",
            exam: exam.id,
            subject: slot.subject,
            course: slot.courseCode,
          });
          await store.fail(slot, adapter.source, error);
        }
        onProgress?.({ stage: "source_event", exam: exam.id });
        onSource?.({
          examId: exam.id,
          source: adapter.source,
          requested: requested.length,
          collected: 0,
          changed: 0,
          finalized: 0,
          rejected: 0,
          failed: true,
          durationMs: Date.now() - started,
        });
        continue;
      }
      for (const slot of requested) polled.add(slotKey(slot));
      let changedCount = 0;
      let finalizedCount = 0;
      let rejectedCount = 0;
      const requestedKeys = new Set(requested.map(slotKey));
      // 한 번의 수집에서 같은 슬롯 값이 서로 다르면 어느 쪽도 저장하지 않는다
      const { kept, conflicting } = dedupeCollected(collected, slotKey);
      for (const key of conflicting) {
        rejectedCount++;
        onProgress?.({ stage: "reject_cut", exam: exam.id, reason: `conflict:${key}` });
      }
      for (const raw of kept) {
        if (!requestedKeys.has(slotKey(raw))) continue;
        const slot = active.get(slotKey(raw));
        if (!slot) continue; // wrong course or exam mapping must never create a DB row
        let value: CollectedGradeCut;
        try {
          value = {
            ...raw,
            ...validateGradeCut({
              exam,
              subject: slot.subject,
              source: adapter.source,
              sourceUrl: raw.sourceUrl,
              cuts: raw.cuts,
              observedAt: raw.observedAt,
              now,
            }),
          };
        } catch (error) {
          if (!(error instanceof GradeCutValidationError)) throw error;
          rejectedCount++;
          onProgress?.({
            stage: "reject_cut",
            exam: exam.id,
            subject: slot.subject,
            course: slot.courseCode,
            reason: error.problem,
          });
          continue;
        }
        onProgress?.({
          stage: "persist_cut",
          exam: exam.id,
          subject: slot.subject,
          course: slot.courseCode,
        });
        const changed = await store.save(exam, slot, adapter.source, value);
        if (changed) {
          result.changed++;
          changedCount++;
          onProgress?.({
            stage: "revalidate",
            exam: exam.id,
            subject: slot.subject,
            course: slot.courseCode,
          });
          await revalidate(exam, slot);
        }
        if (adapter.source === "official") {
          active.delete(slotKey(slot));
          finalizedCount++;
        }
      }
      onProgress?.({ stage: "source_event", exam: exam.id });
      onSource?.({
        examId: exam.id,
        source: adapter.source,
        requested: requested.length,
        collected: collected.length,
        changed: changedCount,
        finalized: finalizedCount,
        rejected: rejectedCount,
        failed: false,
        durationMs: Date.now() - started,
      });
    }
    for (const slot of slots.filter((item) => polled.has(slotKey(item)))) {
      onProgress?.({
        stage: "mark_polled",
        exam: exam.id,
        subject: slot.subject,
        course: slot.courseCode,
      });
      await store.markPolled(slot, now);
      result.polled++;
    }
  }
  return result;
}
