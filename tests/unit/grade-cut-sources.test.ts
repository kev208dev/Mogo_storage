import { describe, expect, it } from "vitest";
import {
  collectGradeCuts,
  GRADE_CUT_SOURCE_POLICIES,
  type GradeCutSourceAdapter,
} from "@/ingestion/grade-cuts/sources";

const exam = {
  year: 2025,
  grade: 3 as const,
  month: 9,
  examType: "kice_mock" as const,
  academicYear: 2026,
};

describe("grade cut source policy", () => {
  it("never auto-collects private-education estimates", async () => {
    const calls: string[] = [];
    const adapters: GradeCutSourceAdapter[] = (["megastudy", "daesung", "ebs"] as const).map(
      (source) => ({
        source,
        async collect() {
          calls.push(source);
          return [];
        },
      }),
    );
    const result = await collectGradeCuts(exam, adapters);
    expect(calls).toEqual([]);
    expect(result.manual.sort()).toEqual(["daesung", "ebs", "megastudy", "official"]);
  });

  it("keeps official vs estimate distinction", () => {
    expect(GRADE_CUT_SOURCE_POLICIES.official.isOfficial).toBe(true);
    for (const s of ["ebs", "megastudy", "daesung"] as const) {
      expect(GRADE_CUT_SOURCE_POLICIES[s].isOfficial).toBe(false);
    }
  });
});
