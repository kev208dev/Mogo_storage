import { describe, expect, it } from "vitest";
import { retryDelayMs } from "@/ingestion/jobs/queue";
import {
  computeReleaseWindow,
  isPollDue,
  isWithinWindow,
  kstDate,
} from "@/ingestion/schedule/release-window";
import { scheduleFileSchema } from "@/ingestion/schedule/schedules";
import { DEFAULT_SOURCE_PRIORITIES, rankSources } from "@/ingestion/sources/config";

describe("release window", () => {
  it("defaults to exam day 12:00 KST → next day 23:59 KST", () => {
    const w = computeReleaseWindow({ examDate: "2025-09-03" });
    expect(w.start.toISOString()).toBe("2025-09-03T03:00:00.000Z");
    expect(w.end.toISOString()).toBe("2025-09-04T14:59:00.000Z");
  });

  it("uses explicit expected release times when present", () => {
    const w = computeReleaseWindow({
      examDate: "2025-11-13",
      expectedReleaseStart: "2025-11-13T17:45:00+09:00",
      expectedReleaseEnd: "2025-11-13T23:00:00+09:00",
    });
    expect(isWithinWindow(w, kstDate("2025-11-13", "17:44"))).toBe(false);
    expect(isWithinWindow(w, kstDate("2025-11-13", "18:00"))).toBe(true);
    expect(isWithinWindow(w, kstDate("2025-11-13", "23:01"))).toBe(false);
  });

  it("repairs an inverted window", () => {
    const w = computeReleaseWindow({
      examDate: "2025-09-03",
      expectedReleaseStart: "2025-09-03T18:00:00+09:00",
      expectedReleaseEnd: "2025-09-03T10:00:00+09:00",
    });
    expect(w.end.getTime() - w.start.getTime()).toBe(6 * 3600 * 1000);
  });

  it("respects the per-source minimum poll interval with a hard floor", () => {
    const now = new Date("2025-09-03T06:00:00Z");
    expect(isPollDue(null, 300, now)).toBe(true);
    expect(isPollDue(new Date(now.getTime() - 299_000), 300, now)).toBe(false);
    expect(isPollDue(new Date(now.getTime() - 300_000), 300, now)).toBe(true);
    // 설정이 10초여도 최소 120초 간격
    expect(isPollDue(new Date(now.getTime() - 60_000), 10, now)).toBe(false);
  });
});

describe("source priority", () => {
  it("KICE first for 평가원 exams, education office first for 학력평가", () => {
    expect(rankSources(["ebsi", "kice"], DEFAULT_SOURCE_PRIORITIES.kice_mock)).toEqual([
      "kice",
      "ebsi",
    ]);
    expect(rankSources(["ebsi", "kice"], DEFAULT_SOURCE_PRIORITIES.csat)).toEqual(["kice", "ebsi"]);
    expect(
      rankSources(["ebsi", "education_office"], DEFAULT_SOURCE_PRIORITIES.school_mock),
    ).toEqual(["education_office", "ebsi"]);
  });
  it("unknown sources go last, deterministically", () => {
    expect(rankSources(["zeta", "ebsi", "alpha"], ["ebsi"])).toEqual(["ebsi", "alpha", "zeta"]);
  });
});

describe("job retry backoff", () => {
  it("is exponential and capped at one hour", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});

describe("schedule file validation", () => {
  it("accepts confirmed schedules and rejects malformed ones", () => {
    expect(
      scheduleFileSchema.safeParse({
        schedules: [
          { year: 2027, grade: 2, month: 3, examType: "school_mock", examDate: "2027-03-24" },
        ],
      }).success,
    ).toBe(true);
    for (const bad of [
      { year: 2027, grade: 4, month: 3, examType: "school_mock", examDate: "2027-03-24" },
      { year: 2027, grade: 2, month: 13, examType: "school_mock", examDate: "2027-03-24" },
      { year: 2027, grade: 2, month: 3, examType: "mock", examDate: "2027-03-24" },
      { year: 2027, grade: 2, month: 3, examType: "school_mock", examDate: "24/03/2027" },
    ]) {
      expect(scheduleFileSchema.safeParse({ schedules: [bad] }).success).toBe(false);
    }
  });
});
