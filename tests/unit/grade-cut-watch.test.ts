import { describe, expect, it, vi } from "vitest";
import {
  cutsFingerprint,
  examEndAt,
  FAST_WINDOW_MS,
  isGradeCutDue,
  LATE_POLL_INTERVAL_MS,
  normalizeCuts,
  runGradeCutWatch,
  WATCH_DEADLINE_MS,
  type GradeCutAdapter,
  type WatchExam,
  type WatchSlot,
  type WatchStore,
} from "../../src/ingestion/grade-cuts/core";
import { isMutedEstimate, orderGradeCutColumns } from "../../src/lib/grade-cuts";
import type { GradeCut } from "../../src/lib/data/types";

const exam: WatchExam = {
  id: "exam",
  year: 2026,
  grade: 3,
  month: 9,
  examType: "kice_mock",
  academicYear: 2027,
  examDate: "2026-09-02",
};
const after = new Date("2026-09-02T09:00:00Z");
const before = new Date("2026-09-02T07:00:00Z");
const korean: WatchSlot = {
  examId: "exam",
  subject: "korean",
  courseId: null,
  courseCode: null,
  status: "waiting",
  lastPolledAt: null,
};
const math: WatchSlot = { ...korean, subject: "math" };
function mockStore(initial: WatchSlot[]) {
  const slots = initial.map((x) => ({ ...x }));
  const values = new Map<string, string>();
  const snapshots: string[] = [];
  const store: WatchStore = {
    dueExams: async () => [exam],
    slots: async () => slots,
    save: async (_exam, slot, source, value) => {
      const key = `${slot.subject}:${source}`;
      const fingerprint = cutsFingerprint(value.cuts);
      const changed = values.get(key) !== fingerprint;
      if (changed) {
        values.set(key, fingerprint);
        snapshots.push(`${key}:${fingerprint}`);
      }
      if (source === "official") slot.status = "finalized";
      return changed;
    },
    markPolled: async (slot, now) => {
      slot.lastPolledAt = now;
    },
    fail: async () => {},
    expire: async (slot) => { slot.status = "failed"; },
  };
  return { store, slots, values, snapshots };
}
function adapter(
  source: GradeCutAdapter["source"],
  subject: WatchSlot["subject"],
  score = 85,
): GradeCutAdapter {
  return {
    source,
    status: "automated_verified",
    collect: vi.fn(async () => [
      {
        subject,
        courseCode: null,
        cuts: [{ grade: 1, rawScore: score }],
        observedAt: after,
        sourceUrl: "https://example.org/cut",
      },
    ]),
  };
}

describe("grade cut watch", () => {
  it("inserts first observation; identical repoll is a no-op; changed value adds a snapshot", async () => {
    const m = mockStore([korean]);
    const mega = adapter("megastudy", "korean", 85);
    const refresh = vi.fn(async () => {});
    expect((await runGradeCutWatch(m.store, [mega], after, refresh)).changed).toBe(1);
    expect(m.snapshots).toHaveLength(1);
    expect(
      (await runGradeCutWatch(m.store, [mega], new Date(after.getTime() + 300_000), refresh))
        .changed,
    ).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    const revised = adapter("megastudy", "korean", 86);
    expect(
      (
        await runGradeCutWatch(
          m.store,
          [revised],
          new Date(after.getTime() + 600_000),
          refresh,
        )
      ).changed,
    ).toBe(1);
    expect(m.snapshots).toEqual([
      "korean:megastudy:1:85",
      "korean:megastudy:1:86",
    ]);
  });
  it("finalizes only the official slot and never calls its estimate adapter again", async () => {
    const m = mockStore([korean, math]);
    const official = adapter("official", "korean", 87);
    const mega = adapter("megastudy", "math", 84);
    await runGradeCutWatch(m.store, [mega, official], after);
    expect(m.slots.map((s) => s.status)).toEqual(["finalized", "waiting"]);
    expect(mega.collect).toHaveBeenCalledWith(exam, [
      expect.objectContaining({ subject: "math" }),
    ]);
    await runGradeCutWatch(m.store, [mega], new Date(after.getTime() + 300_000));
    expect(mega.collect).toHaveBeenCalledTimes(2);
    expect((mega.collect as ReturnType<typeof vi.fn>).mock.calls[1]![1]).toEqual([
      expect.objectContaining({ subject: "math" }),
    ]);
  });
  it("isolates a failing source and saves the next", async () => {
    const m = mockStore([korean]);
    const bad: GradeCutAdapter = {
      source: "daesung",
      status: "automated_verified",
      collect: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };
    const good = adapter("ebs", "korean");
    const result = await runGradeCutWatch(m.store, [bad, good], after);
    expect(result).toMatchObject({ changed: 1, failures: 1 });
  });
  it("skips before the exam ends and observes a five-minute cadence", async () => {
    const m = mockStore([korean]);
    const mega = adapter("megastudy", "korean");
    expect(examEndAt(exam).toISOString()).toBe("2026-09-02T08:30:00.000Z");
    await runGradeCutWatch(m.store, [mega], before);
    expect(mega.collect).not.toHaveBeenCalled();
    await runGradeCutWatch(m.store, [mega], after);
    await runGradeCutWatch(m.store, [mega], new Date(after.getTime() + 299_999));
    expect(mega.collect).toHaveBeenCalledTimes(1);
    expect(isGradeCutDue(exam, m.slots[0]!, new Date(after.getTime() + 300_000))).toBe(
      true,
    );
  });
  it("reduces late polling and expires unresolved slots", async () => {
    const m = mockStore([korean]);
    const mega = adapter("megastudy", "korean");
    const end = examEndAt(exam).getTime();
    const late = new Date(end + FAST_WINDOW_MS + 1);
    m.slots[0]!.lastPolledAt = new Date(late.getTime() - LATE_POLL_INTERVAL_MS + 1);
    expect(isGradeCutDue(exam, m.slots[0]!, late)).toBe(false);
    m.slots[0]!.lastPolledAt = new Date(late.getTime() - LATE_POLL_INTERVAL_MS);
    expect(isGradeCutDue(exam, m.slots[0]!, late)).toBe(true);
    await runGradeCutWatch(m.store, [mega], new Date(end + WATCH_DEADLINE_MS));
    expect(m.slots[0]!.status).toBe("failed");
    expect(mega.collect).not.toHaveBeenCalled();
  });
  it("rejects malformed cuts and ignores unknown course mapping", async () => {
    expect(() =>
      normalizeCuts([
        { grade: 1, rawScore: 85 },
        { grade: 1, rawScore: 80 },
      ]),
    ).toThrow();
    expect(() => normalizeCuts([{ grade: 1, rawScore: 101 }])).toThrow();
    expect(
      cutsFingerprint([
        { grade: 2, rawScore: 75 },
        { grade: 1, rawScore: 85 },
      ]),
    ).toBe("1:85|2:75");
    const m = mockStore([korean]);
    const unknown: GradeCutAdapter = {
      source: "megastudy",
      status: "automated_verified",
      collect: async () => [
        {
          subject: "social",
          courseCode: "wrong",
          cuts: [{ grade: 1, rawScore: 85 }],
          sourceUrl: "https://example.org",
          observedAt: after,
        },
      ],
    };
    expect((await runGradeCutWatch(m.store, [unknown], after)).changed).toBe(0);
    expect(m.snapshots).toHaveLength(0);
  });
  it("never calls unverified adapters or marks a fake poll", async () => {
    const m = mockStore([korean]);
    const unverified = {
      ...adapter("megastudy", "korean"),
      status: "disabled_unverified" as const,
    };
    const result = await runGradeCutWatch(m.store, [unverified], after);
    expect(unverified.collect).not.toHaveBeenCalled();
    expect(result.polled).toBe(0);
    expect(m.slots[0]!.lastPolledAt).toBeNull();
  });
  it("orders official first for display and score calculation", () => {
    const make = (source: GradeCut["source"], isOfficial: boolean): GradeCut => ({
      id: source,
      examId: exam.id,
      subject: "korean",
      courseId: null,
      source,
      sourceUrl: null,
      isOfficial,
      isSample: false,
      cuts: [{ grade: 1, rawScore: 85 }],
      updatedAt: after.toISOString(),
    });
    const columns = orderGradeCutColumns([
      make("ebs", false),
      make("official", true),
      make("megastudy", false),
    ]);
    expect(columns.map((c) => c.source)).toEqual(["official", "megastudy", "ebs"]);
    expect(isMutedEstimate(columns[1]!, columns)).toBe(true);
    expect(isMutedEstimate(columns[0]!, columns)).toBe(false);
  });
});
