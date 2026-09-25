import type { ExamType, GradeCutSource, Subject } from "../../lib/constants";
import type { GradeCutEntry } from "../../lib/data/types";

export type AdapterStatus = "automated_verified" | "disabled_unverified" | "disabled_policy";
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
  collect(exam: WatchExam, slots: readonly WatchSlot[]): Promise<CollectedGradeCut[]>;
}

/** The same grades in any input order have the same fingerprint. Reject invented or malformed scores. */
export function normalizeCuts(cuts: GradeCutEntry[]): GradeCutEntry[] {
  if (!Array.isArray(cuts) || cuts.length === 0 || cuts.length > 9)
    throw new Error("empty or oversized cuts");
  const sorted = cuts
    .map((c) => ({ grade: c.grade, rawScore: c.rawScore }))
    .sort((a, b) => a.grade - b.grade);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    if (
      !Number.isInteger(c.grade) ||
      c.grade < 1 ||
      c.grade > 9 ||
      !Number.isInteger(c.rawScore) ||
      c.rawScore < 0 ||
      c.rawScore > 100 ||
      (i > 0 &&
        (c.grade === sorted[i - 1]!.grade || c.rawScore > sorted[i - 1]!.rawScore))
    )
      throw new Error("invalid grade cut");
  }
  return sorted;
}
export function cutsFingerprint(cuts: GradeCutEntry[]): string {
  return normalizeCuts(cuts)
    .map((c) => `${c.grade}:${c.rawScore}`)
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
  return (
    slot.status !== "finalized" &&
    now >= examEndAt(exam) &&
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

/** Adapter errors are isolated; persistence errors still surface so a broken DB is visible to operations. */
export async function runGradeCutWatch(
  store: WatchStore,
  adapters: readonly GradeCutAdapter[],
  now: Date,
  revalidate: (exam: WatchExam, slot: WatchSlot) => Promise<void> = async () => {},
): Promise<WatchResult> {
  const result: WatchResult = { changed: 0, failures: 0, polled: 0 };
  for (const exam of await store.dueExams(now)) {
    if (now < examEndAt(exam)) continue;
    const slots = (await store.slots(exam)).filter((slot) => isGradeCutDue(exam, slot, now));
    if (!slots.length) continue;
    // Official sources run first, then finalized slots are removed before estimated adapters run.
    const verified = adapters
      .filter((a) => a.status === "automated_verified")
      .sort((a, b) => Number(b.source === "official") - Number(a.source === "official"));
    // Do not make a watch state look "polled" when no verified source was actually called.
    if (!verified.length) continue;

    const active = new Map(slots.map((slot) => [slotKey(slot), slot]));
    for (const adapter of verified) {
      const requested = [...active.values()];
      if (!requested.length) break;
      let collected: CollectedGradeCut[];
      try {
        collected = await adapter.collect(exam, requested);
      } catch (error) {
        result.failures++;
        for (const slot of requested) await store.fail(slot, adapter.source, error);
        continue;
      }
      for (const value of collected) {
        const slot = active.get(slotKey(value));
        if (!slot) continue; // wrong course or exam mapping must never create a DB row
        const changed = await store.save(exam, slot, adapter.source, value);
        if (changed) {
          result.changed++;
          await revalidate(exam, slot);
        }
        if (adapter.source === "official") active.delete(slotKey(slot));
      }
    }
    for (const slot of slots) {
      await store.markPolled(slot, now);
      result.polled++;
    }
  }
  return result;
}
