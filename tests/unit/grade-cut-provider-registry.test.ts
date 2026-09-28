import { describe, expect, it } from "vitest";
import {
  GRADE_CUT_PROVIDERS,
  GRADE_CUT_PROVIDER_POLICIES,
  assertProviderProvenance,
} from "@/ingestion/grade-cuts/provider-registry";

describe("grade cut provider registry", () => {
  it("classifies every target provider", () => {
    expect(GRADE_CUT_PROVIDERS).toHaveLength(8);
    const registered = Object.keys(GRADE_CUT_PROVIDER_POLICIES).sort();
    const expected = [...GRADE_CUT_PROVIDERS].sort();
    expect(registered).toEqual(expected);
    expect(GRADE_CUT_PROVIDER_POLICIES.megastudy.automation).toBe("automated_first_party");
    expect(GRADE_CUT_PROVIDER_POLICIES.ebsi.automation).toBe("blocked_policy");
    expect(GRADE_CUT_PROVIDER_POLICIES.daesung.automation).toBe("blocked_policy");
  });

  it("keeps secondary observations honest", () => {
    expect(() =>
      assertProviderProvenance({
        provider: "daesung",
        sourceUrl: "https://jinhak.com/public-comparison",
        firstParty: false,
        observedVia: "jinhak",
        observedAt: "2026-09-02T10:00:00+09:00",
        isOfficial: false,
        status: "estimated",
      }),
    ).not.toThrow();
    expect(() =>
      assertProviderProvenance({
        provider: "daesung",
        sourceUrl: "https://jinhak.com/public-comparison",
        firstParty: true,
        observedVia: "jinhak",
        observedAt: "2026-09-02T10:00:00+09:00",
        isOfficial: false,
        status: "estimated",
      }),
    ).toThrow();
  });
});
