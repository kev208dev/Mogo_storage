import { describe, expect, it } from "vitest";
import { processableStudyArtifactVersion } from "@/ingestion/study/backfill";

describe("English study backfill policy", () => {
  it("never schedules network processing for operator-import URLs", () => {
    expect(
      processableStudyArtifactVersion({
        sourceId: "operator_import",
        contentFingerprint: "operator:https://example.test/file.pdf",
        sha256: "abc",
      }),
    ).toBeNull();
  });

  it("uses verified content fingerprint before full-file hash", () => {
    expect(
      processableStudyArtifactVersion({
        sourceId: "ebsi",
        contentFingerprint: "probe:123",
        sha256: "abc",
      }),
    ).toBe("probe:123");
  });

  it("falls back to sha256 only for non-operator verified artifacts", () => {
    expect(
      processableStudyArtifactVersion({
        sourceId: "ebsi",
        contentFingerprint: null,
        sha256: "abc",
      }),
    ).toBe("abc");
    expect(
      processableStudyArtifactVersion({
        sourceId: "ebsi",
        contentFingerprint: null,
        sha256: null,
      }),
    ).toBeNull();
  });
});
