import { describe, expect, it } from "vitest";
import {
  featureStatus,
  isCapabilityPolicyBlocked,
  policyBlockers,
  sourceStatusMatrix,
} from "@/ingestion/sources/policy";
import { BUILTIN_SOURCES } from "@/ingestion/sources/config";
import { canRun } from "@/ingestion/sources/verification";

const ALL = { discovery: true, artifacts: true, release_watch: true };
const runtime = (over = {}) => ({
  enabled: true,
  liveVerified: true,
  capabilities: ALL,
  healthStatus: "healthy" as const,
  ...over,
});

describe("source × 기능 자동화 정책", () => {
  it("robots 가 막는 기능은 disabled_policy, 운영자 입력은 manual_only", () => {
    expect(featureStatus("kice", "discover_exams", runtime())).toBe("disabled_policy");
    expect(featureStatus("kice", "fetch_file", runtime())).toBe("disabled_policy");
    expect(featureStatus("ebsi", "discover_exams", runtime())).toBe("disabled_policy");
    expect(featureStatus("education_office", "discover_files")).toBe("disabled_policy");
    expect(featureStatus("operator_import", "discover_files")).toBe("manual_only");
    expect(featureStatus("operator_import", "release_watch")).toBe("not_applicable");
  });

  it("한 source 가 일부 기능만 지원: EBSi 파일 서버 확인은 구현 기능이라 검증·활성화 상태로 결정", () => {
    expect(featureStatus("ebsi", "fetch_file")).toBe("disabled_unverified");
    expect(featureStatus("ebsi", "fetch_file", runtime())).toBe("automated_verified");
    expect(featureStatus("ebsi", "fetch_file", runtime({ healthStatus: "network_error" }))).toBe(
      "degraded",
    );
    expect(featureStatus("ebsi", "fetch_file", runtime({ liveVerified: false }))).toBe(
      "disabled_unverified",
    );
  });

  it("정책상 금지된 capability 는 DB 가 켜져 있어도 canRun 이 거부한다 (테스트 전용 allowUnverified 제외)", () => {
    for (const id of ["kice", "ebsi", "education_office"]) {
      expect(isCapabilityPolicyBlocked(id, "discovery")).toBe(true);
      expect(canRun({ id, ...runtime() }, "discovery")).toBe(false);
      expect(canRun({ id, ...runtime() }, "release_watch")).toBe(false);
    }
    // 정책 표에 없는 source(향후 추가될 공개 source 등)는 기존 검증 게이트만 적용
    expect(canRun({ id: "future_public_source", ...runtime() }, "discovery")).toBe(true);
    expect(canRun({ id: "ebsi", ...runtime() }, "discovery", { allowUnverified: true })).toBe(true);
  });

  it("source 활성화 차단 사유에 근거 URL 과 확인일이 들어간다", () => {
    expect(policyBlockers("kice")[0]).toMatch(/suneung\.re\.kr\/robots\.txt, 2026-09-25/);
    expect(policyBlockers("operator_import")[0]).toMatch(/수동 전용/);
    expect(policyBlockers("future_public_source")).toEqual([]);
  });

  it("시험자료·등급컷 source 를 한 표로 보여준다", () => {
    const rows = sourceStatusMatrix(BUILTIN_SOURCES);
    const by = Object.fromEntries(rows.map((r) => [r.source, r]));
    expect(by["kice"]!.features.discover_exams).toBe("disabled_policy");
    expect(by["ebsi"]!.notes.join()).toMatch(/robots\.txt 없음/);
    expect(by["grade_cut:megastudy"]!.features.grade_cuts).toBe("automated_verified");
    expect(by["grade_cut:daesung"]!.features.grade_cuts).toBe("disabled_policy");
    expect(by["grade_cut:megastudy"]!.features.discover_exams).toBe("not_applicable");
  });
});
