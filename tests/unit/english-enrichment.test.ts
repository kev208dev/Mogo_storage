import { describe, expect, it } from "vitest";
import { enrichmentEligibility } from "@/ingestion/english/enrichment";

const verifiedAt = new Date("2026-10-06T00:00:00Z");

describe("English enrichment operator approval gate", () => {
  it("accepts only browser-approved operator imports on the file allowlist", () => {
    expect(
      enrichmentEligibility({
        url: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
        sourceId: "operator_import",
        artifactStatus: "ready",
        verificationMode: "operator_browser",
        verifiedAt,
        sourceUrl: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
        finalUrl: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    ["operator_browser_verification_required", { verificationMode: "operator" }],
    ["artifact_not_ready", { artifactStatus: "manual_review" }],
    ["artifact_not_verified", { verifiedAt: null }],
    [
      "published_url_not_verified",
      { sourceUrl: "https://wdown.ebsi.co.kr/other.pdf", finalUrl: null },
    ],
    [
      "host_not_allowed",
      {
        url: "https://example.com/test.pdf",
        sourceUrl: "https://example.com/test.pdf",
        finalUrl: "https://example.com/test.pdf",
      },
    ],
  ])("rejects %s", (reason, patch) => {
    const result = enrichmentEligibility({
      url: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
      sourceId: "operator_import",
      artifactStatus: "ready",
      verificationMode: "operator_browser",
      verifiedAt,
      sourceUrl: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
      finalUrl: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
      ...patch,
    });
    expect(result).toEqual({ ok: false, reason });
  });

  it("also accepts a normally verified source artifact on the same allowlist", () => {
    expect(
      enrichmentEligibility({
        url: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
        sourceId: "ebsi",
        artifactStatus: "ready",
        verificationMode: "probe",
        verifiedAt,
        sourceUrl: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
        finalUrl: "https://wdown.ebsi.co.kr/W61001/01exam/test.pdf",
      }),
    ).toEqual({ ok: true });
  });
});
