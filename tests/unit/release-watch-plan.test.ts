import { describe, expect, it } from "vitest";
import { effectiveExpectedAt, planPoll, type WatchSlot } from "@/ingestion/schedule/artifact-watch";

const kst = (hhmm: string, date = "2025-11-13") => new Date(`${date}T${hhmm}:00+09:00`);
const slot = (over: Partial<WatchSlot>): WatchSlot => ({
  subject: "korean",
  slotKey: "",
  type: "question",
  status: "waiting",
  expectedAt: kst("10:56"),
  expectedSource: "official",
  ...over,
});

describe("확인 시작 시각 우선순위", () => {
  it("공식 공개 시각 > 일정 metadata > 기본 시간대", () => {
    const fallback = kst("12:00");
    expect(
      effectiveExpectedAt({ official: kst("10:56"), schedule: kst("11:30"), fallback }),
    ).toEqual({ at: kst("10:56"), source: "official" });
    expect(effectiveExpectedAt({ schedule: kst("11:30"), fallback })).toEqual({
      at: kst("11:30"),
      source: "schedule",
    });
    expect(effectiveExpectedAt({ fallback })).toEqual({ at: fallback, source: "fallback" });
  });
});

describe("planPoll (자료 단위 release watch)", () => {
  const base = { minIntervalSeconds: 300, lastPolledAt: null };

  it("공개 예정 2분 전까지는 요청하지 않는다 (idle, 다음 확인 시각 제공)", () => {
    const p = planPoll({ ...base, states: [slot({})], now: kst("10:50") });
    expect(p).toMatchObject({ phase: "idle", due: false });
    expect(p.nextAt).toEqual(kst("10:54"));
  });

  it("10:54 부터 낮은 빈도 (최소 간격의 2배)", () => {
    const p = planPoll({ ...base, states: [slot({})], now: kst("10:54") });
    expect(p).toMatchObject({ phase: "pre_release", due: true, intervalSeconds: 600 });
    expect(
      planPoll({ ...base, states: [slot({})], now: kst("10:55"), lastPolledAt: kst("10:54") }).due,
    ).toBe(false);
  });

  it("10:56 이후 source 최소 간격으로 확인", () => {
    const p = planPoll({
      ...base,
      states: [slot({})],
      now: kst("10:59"),
      lastPolledAt: kst("10:54"),
    });
    expect(p).toMatchObject({ phase: "released", due: true, intervalSeconds: 300 });
  });

  it("최소 간격 설정이 너무 짧아도 120초보다 자주 요청하지 않는다", () => {
    const p = planPoll({
      states: [slot({})],
      now: kst("11:00"),
      minIntervalSeconds: 10,
      lastPolledAt: kst("10:59"),
    });
    expect(p).toMatchObject({ intervalSeconds: 120, due: false });
  });

  it("확보한 자료는 기다리지 않는다: 영어 음원만 남으면 음원 공개 시각에 맞춰서만 확인", () => {
    const states = [
      slot({ subject: "english", type: "question", status: "found", expectedAt: kst("17:04") }),
      slot({ subject: "english", type: "listening_audio", expectedAt: kst("17:04") }),
      slot({ subject: "korean", status: "found" }),
    ];
    const p = planPoll({ ...base, states, now: kst("17:10") });
    expect(p.active.map((a) => `${a.subject}:${a.type}`)).toEqual(["english:listening_audio"]);
    expect(p.waiting).toBe(1);
  });

  it("모든 자료를 확보하면 complete — 더 이상 요청하지 않는다", () => {
    const p = planPoll({ ...base, states: [slot({ status: "found" })], now: kst("12:00") });
    expect(p).toMatchObject({ phase: "complete", due: false });
  });

  it("공식 시각 2시간 뒤에도 없으면 간격을 늘린다 (기본 시간대는 제외)", () => {
    expect(planPoll({ ...base, states: [slot({})], now: kst("13:00") })).toMatchObject({
      phase: "backoff",
      intervalSeconds: 900,
    });
    expect(
      planPoll({
        ...base,
        states: [slot({ expectedAt: kst("12:00"), expectedSource: "fallback" })],
        now: kst("15:00"),
      }),
    ).toMatchObject({ phase: "released", intervalSeconds: 300 });
  });

  it("공식 공개 시각 표가 있고 아직 못 읽었으면 시험일에 1시간 간격으로 표만 확인", () => {
    const p = planPoll({
      ...base,
      states: [slot({ expectedAt: kst("12:00"), expectedSource: "fallback" })],
      now: kst("08:00"),
      needsReleaseTimes: true,
    });
    expect(p).toMatchObject({ phase: "fetch_release_times", due: true, intervalSeconds: 3600 });
  });
});
