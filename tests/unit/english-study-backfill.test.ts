import { describe, expect, it } from "vitest";
import { isApprovedOperatorStudyArtifact } from "@/ingestion/study/artifact-fetch";
import { processableStudyArtifactVersion } from "@/ingestion/study/backfill";

const base = {
  sourceUrl: "https://wdown.ebsi.co.kr/W61001/01exam/20260902/go3/eng_1_hsj_TEST.pdf",
  status: "ready" as const,
  verificationMode: "operator_browser",
  verifiedAt: new Date("2026-10-01T00:00:00Z"),
  finalUrl: "https://wdown.ebsi.co.kr/W61001/01exam/20260902/go3/eng_1_hsj_TEST.pdf",
  type: "solution" as const,
  contentFingerprint: "operator:test",
  sha256: null,
};

describe("English study backfill policy", () => {
  it("allows only browser-approved EBSi direct files from operator imports", () => {
    expect(isApprovedOperatorStudyArtifact({ ...base, sourceId: "operator_import" })).toBe(true);
    expect(
      isApprovedOperatorStudyArtifact({
        ...base,
        sourceId: "operator_import",
        sourceUrl: "https://www.kice.re.kr/file.pdf",
        finalUrl: "https://www.kice.re.kr/file.pdf",
      }),
    ).toBe(false);
    expect(
      isApprovedOperatorStudyArtifact({
        ...base,
        sourceId: "operator_import",
        verificationMode: "operator",
      }),
    ).toBe(false);
  });

  it("uses approved operator fingerprint but blocks non-approved operator URLs", () => {
    expect(processableStudyArtifactVersion({ ...base, sourceId: "operator_import" })).toBe(
      "operator:test",
    );
    expect(
      processableStudyArtifactVersion({
        ...base,
        sourceId: "operator_import",
        status: "manual_review",
      }),
    ).toBeNull();
  });

  it("uses verified content fingerprint before full-file hash for normal sources", () => {
    expect(
      processableStudyArtifactVersion({
        ...base,
        sourceId: "ebsi",
        contentFingerprint: "probe:123",
        sha256: "abc",
      }),
    ).toBe("probe:123");
  });

  it("falls back to sha256 only when a version exists", () => {
    expect(
      processableStudyArtifactVersion({
        ...base,
        sourceId: "ebsi",
        contentFingerprint: null,
        sha256: "abc",
      }),
    ).toBe("abc");
    expect(
      processableStudyArtifactVersion({
        ...base,
        sourceId: "ebsi",
        contentFingerprint: null,
        sha256: null,
      }),
    ).toBeNull();
  });
});
