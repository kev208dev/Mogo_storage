import { describe, expect, it } from "vitest";
import { backfillStage } from "@/ingestion/audit";
import {
  healthStatusForError,
  IngestionError,
  RobotsDisallowedError,
  SourceFetchError,
  SourceStructureChangedError,
} from "@/ingestion/errors";
import { activationBlockers, canRun, currentParserVersion } from "@/ingestion/sources/verification";

const ALL = { discovery: true, artifacts: true, release_watch: true };
const source = (over: Partial<Parameters<typeof canRun>[0]> = {}) => ({
  enabled: true,
  liveVerified: true,
  capabilities: { ...ALL },
  healthStatus: "healthy" as const,
  ...over,
});

describe("구조 변경 vs 네트워크 장애", () => {
  it.each([
    [new SourceStructureChangedError("ebsi", "x"), "structure_changed"],
    [new RobotsDisallowedError("https://www.ebsi.co.kr/a"), "structure_changed"],
    [new SourceFetchError("HTTP 404", false, 404), "structure_changed"],
    [new IngestionError("INDEX_EXAM_MISMATCH", "x"), "structure_changed"],
    [new SourceFetchError("request timed out", true), "network_error"],
    [new SourceFetchError("HTTP 503", true, 503), "network_error"],
    [new SourceFetchError("HTTP 429", true, 429), "network_error"],
    [new SourceFetchError("HTTP 403", false, 403), "network_error"],
  ])("%s → %s", (error, status) => expect(healthStatusForError(error)).toBe(status));
});

describe("기능 단위 게이트 (canRun)", () => {
  it("검증·enabled·기능이 모두 있어야 실행", () => {
    expect(canRun(source(), "release_watch")).toBe(true);
    expect(canRun(source({ enabled: false }), "discovery")).toBe(false);
    expect(canRun(source({ liveVerified: false }), "discovery")).toBe(false);
  });
  it("구조 변경·미검증·이전 broken 상태에서는 아무 기능도 실행하지 않는다", () => {
    for (const healthStatus of ["structure_changed", "broken", "unverified"] as const)
      expect(canRun(source({ healthStatus }), "discovery")).toBe(false);
    // 네트워크 장애는 재시도 대상
    expect(canRun(source({ healthStatus: "network_error" }), "discovery")).toBe(true);
  });
  it("단계적: artifacts 는 discovery, release_watch 는 artifacts 가 필요", () => {
    const only = (c: Partial<typeof ALL>) =>
      source({ capabilities: { discovery: false, artifacts: false, release_watch: false, ...c } });
    expect(canRun(only({ discovery: true }), "artifacts")).toBe(false);
    expect(canRun(only({ artifacts: true }), "artifacts")).toBe(false);
    expect(canRun(only({ release_watch: true, artifacts: true }), "release_watch")).toBe(false);
    expect(canRun(only({ discovery: true, artifacts: true }), "artifacts")).toBe(true);
  });
  it("allowUnverified(코드 전용 테스트 옵션)도 기능 플래그는 우회하지 않는다", () => {
    const s = source({ liveVerified: false, capabilities: { ...ALL, artifacts: false } });
    expect(canRun(s, "discovery", { allowUnverified: true })).toBe(true);
    expect(canRun(s, "artifacts", { allowUnverified: true })).toBe(false);
  });
});

describe("production 활성화 조건", () => {
  const now = new Date("2026-09-24T00:00:00Z");
  const ready = {
    kind: "ebsi",
    liveFixtureValidatedAt: new Date("2026-09-23T00:00:00Z"),
    liveFixtureParserVersion: currentParserVersion("ebsi"),
    verifiedAgainstLiveFixture: true,
    verifiedParserVersion: currentParserVersion("ebsi"),
    healthStatus: "healthy" as const,
    lastHealthCheckAt: new Date("2026-09-23T12:00:00Z"),
  };
  it("fixture 검증 · 현재 parser 일치 · 승인 · 24시간 내 health check 통과 → 가능", () => {
    expect(activationBlockers(ready, now)).toEqual([]);
  });
  it("하나라도 빠지면 이유와 함께 막힌다", () => {
    expect(activationBlockers({ ...ready, liveFixtureValidatedAt: null }, now)).toContain(
      "live fixture 검증 기록 없음",
    );
    expect(
      activationBlockers({ ...ready, liveFixtureParserVersion: "ebsi-v0" }, now).join(),
    ).toMatch(/이전 parser/);
    expect(activationBlockers({ ...ready, verifiedAgainstLiveFixture: false }, now).join()).toMatch(
      /승인/,
    );
    expect(
      activationBlockers({ ...ready, lastHealthCheckAt: new Date("2026-09-20T00:00:00Z") }, now),
    ).toContain("최근 24시간 health check 없음");
    expect(activationBlockers({ ...ready, healthStatus: "degraded" }, now).join()).toMatch(
      /degraded/,
    );
  });
});

describe("canary 단계", () => {
  it.each([
    [2026, "canary_1y"],
    [2025, "canary_1y"],
    [2024, "canary_3y"],
    [2023, "canary_3y"],
    [2022, "full"],
    [2006, "full"],
  ])("from %i (올해 2026) → %s", (from, stage) => expect(backfillStage(from, 2026)).toBe(stage));
});
