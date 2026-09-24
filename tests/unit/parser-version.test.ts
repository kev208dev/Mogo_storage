import { describe, expect, it } from "vitest";
import parserVersions from "@/ingestion/sources/parser-versions.json";
import { PARSER_VERSION_FILES } from "@/ingestion/sources/parser-version-files";
import { canIngest, currentParserVersion, isLiveVerified } from "@/ingestion/sources/verification";
import { computeParserHash } from "../../scripts/parser-version";

describe("parser version", () => {
  it.each(Object.keys(PARSER_VERSION_FILES))(
    "%s: parser files match the recorded hash (bump with `npm run ingest:parser-version`)",
    (source) => {
      const recorded = (parserVersions as Record<string, { version: string; hash: string }>)[
        source
      ];
      expect(recorded, "missing entry in parser-versions.json").toBeDefined();
      expect(
        computeParserHash(PARSER_VERSION_FILES[source]!),
        `${source} parser code changed: run npm run ingest:parser-version (live fixture re-verification will be required)`,
      ).toBe(recorded!.hash);
    },
  );

  it("verification is only valid for the parser version it was approved for", () => {
    const v = currentParserVersion("ebsi")!;
    expect(
      isLiveVerified("ebsi", { verifiedAgainstLiveFixture: true, verifiedParserVersion: v }),
    ).toBe(true);
    expect(
      isLiveVerified("ebsi", {
        verifiedAgainstLiveFixture: true,
        verifiedParserVersion: "ebsi-v0",
      }),
    ).toBe(false);
    expect(
      isLiveVerified("ebsi", { verifiedAgainstLiveFixture: false, verifiedParserVersion: v }),
    ).toBe(false);
  });

  it("ingestion requires enabled AND live verification", () => {
    expect(canIngest({ enabled: true, liveVerified: false })).toBe(false);
    expect(canIngest({ enabled: false, liveVerified: true })).toBe(false);
    expect(canIngest({ enabled: true, liveVerified: true })).toBe(true);
  });
});
