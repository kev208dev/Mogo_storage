import { describe, expect, it, vi } from "vitest";
import {
  cutsFingerprint,
  examEndAt,
  isGradeCutDue,
  normalizeCuts,
  runGradeCutWatch,
  type GradeCutAdapter,
  type WatchExam,
  type WatchSlot,
  type WatchStore,
  type WatchProgress,
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
  };
  return { store, slots, values, snapshots };
}
const URLS: Record<GradeCutAdapter["source"], string> = {
  official: "https://www.suneung.re.kr/cut",
  megastudy: "https://m.megastudy.net/cut",
  daesung: "https://www.mimacstudy.com/cut",
  ebs: "https://www.ebsi.co.kr/cut",
  jongro: "https://www.jongro.co.kr/cut",
  etoos: "https://www.etoos.com/cut",
  jinhak: "https://www.jinhak.com/cut",
  uway: "https://www.uway.com/cut",
  kimyoungil: "https://www.kimyoungil.com/cut",
};
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
        sourceUrl: URLS[source],
      },
    ]),
  };
}

describe("grade cut watch", () => {
  it("attributes collect, persistence, revalidation and completion failures to safe stages", async () => {
    const stages = ["adapter_collect", "persist_cut", "revalidate", "mark_polled"] as const;
    for (const stage of stages) {
      const m = mockStore([korean]);
      const progress: WatchProgress[] = [];
      const mega = adapter("megastudy", "korean");
      if (stage === "adapter_collect")
        mega.collect = async () => {
          throw new Error("source failure");
        };
      if (stage === "persist_cut")
        m.store.save = async () => {
          throw new Error("save failed");
        };
      if (stage === "mark_polled")
        m.store.markPolled = async () => {
          throw new Error("completion failed");
        };
      const run = () =>
        runGradeCutWatch(
          m.store,
          [mega],
          after,
          async () => {
            if (stage === "revalidate") throw new Error("revalidation failed");
          },
          undefined,
          (value) => progress.push(value),
        );
      if (stage === "adapter_collect") {
        expect((await run()).failures).toBe(1);
        expect(progress.some((value) => value.stage === "source_failure")).toBe(true);
      } else {
        await expect(run()).rejects.toThrow();
        expect(progress.at(-1)?.stage).toBe(stage);
      }
    }
  });
  it("keeps 17 saved cuts if first completion fails, while unsupported slots remain unpolled", async () => {
    const courses = Array.from({ length: 17 }, (_, index): WatchSlot => ({
      ...korean,
      subject: index < 9 ? "social" : "science",
      courseId: `course-${index}`,
      courseCode: `course-${index}`,
    }));
    const slots = [...courses, korean, math];
    const values: string[] = [];
    const polled: string[] = [];
    const store: WatchStore = {
      dueExams: async () => [exam],
      slots: async () => slots,
      save: async (_exam, slot) => {
        values.push(slot.courseId!);
        return true;
      },
      markPolled: async (slot) => {
        polled.push(slot.courseId!);
        throw new Error("first mark failed");
      },
      fail: async () => {},
    };
    const mega: GradeCutAdapter = {
      source: "megastudy",
      status: "automated_verified",
      supports: (_exam, slot) =>
        Boolean(slot.courseCode && (slot.subject === "social" || slot.subject === "science")),
      collect: vi.fn(async (_exam: WatchExam, requested: readonly WatchSlot[]) =>
        requested.map((slot) => ({
          subject: slot.subject,
          courseCode: slot.courseCode,
          cuts: [{ grade: 1, rawScore: 47 }],
          observedAt: after,
          sourceUrl: URLS.megastudy,
        })),
      ),
    };
    const progress: WatchProgress[] = [];
    await expect(
      runGradeCutWatch(
        store,
        [mega],
        after,
        async () => {},
        undefined,
        (value) => progress.push(value),
      ),
    ).rejects.toThrow("first mark failed");
    expect(mega.collect).toHaveBeenCalledWith(exam, courses);
    expect(values).toHaveLength(17);
    expect(polled).toEqual(["course-0"]);
    expect(progress.at(-1)).toMatchObject({
      stage: "mark_polled",
      subject: "social",
      course: "course-0",
    });
  });
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
      (await runGradeCutWatch(m.store, [revised], new Date(after.getTime() + 600_000), refresh))
        .changed,
    ).toBe(1);
    expect(m.snapshots).toEqual(["korean:megastudy:1:85", "korean:megastudy:1:86"]);
  });
  it("finalizes only the official slot and never calls its estimate adapter again", async () => {
    const m = mockStore([korean, math]);
    const official = adapter("official", "korean", 87);
    const mega = adapter("megastudy", "math", 84);
    await runGradeCutWatch(m.store, [mega, official], after);
    expect(m.slots.map((s) => s.status)).toEqual(["finalized", "waiting"]);
    expect(mega.collect).toHaveBeenCalledWith(exam, [expect.objectContaining({ subject: "math" })]);
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
    expect(isGradeCutDue(exam, m.slots[0]!, new Date(after.getTime() + 300_000))).toBe(true);
  });
  it("keeps five-minute cadence after 72 hours for an unresolved slot", async () => {
    const m = mockStore([{ ...korean, status: "finalized" }, math]);
    const mega = adapter("megastudy", "math");
    const late = new Date(examEndAt(exam).getTime() + 72 * 60 * 60_000);
    await runGradeCutWatch(m.store, [mega], late);
    expect(mega.collect).toHaveBeenCalledWith(exam, [expect.objectContaining({ subject: "math" })]);
    await runGradeCutWatch(m.store, [mega], new Date(late.getTime() + 299_999));
    expect(mega.collect).toHaveBeenCalledTimes(1);
    await runGradeCutWatch(m.store, [mega], new Date(late.getTime() + 300_000));
    expect(mega.collect).toHaveBeenCalledTimes(2);
    expect((mega.collect as ReturnType<typeof vi.fn>).mock.calls[1]![1]).toEqual([
      expect.objectContaining({ subject: "math" }),
    ]);
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
          sourceUrl: URLS.megastudy,
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
  it("never hands absolute-evaluation slots to an adapter", async () => {
    const english: WatchSlot = { ...korean, subject: "english" };
    const history: WatchSlot = { ...korean, subject: "history" };
    const m = mockStore([english, history, korean]);
    const mega = adapter("megastudy", "korean");
    await runGradeCutWatch(m.store, [mega], after);
    expect(mega.collect).toHaveBeenCalledWith(exam, [
      expect.objectContaining({ subject: "korean" }),
    ]);
    expect(m.slots.slice(0, 2).map((s) => s.lastPolledAt)).toEqual([null, null]);
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
