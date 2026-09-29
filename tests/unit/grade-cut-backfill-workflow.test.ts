import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveGradeCutFetcherMode } from "../../src/ingestion/cli/grade-cut-backfill-mode";

const workflow = readFileSync(
  new URL("../../.github/workflows/grade-cut-backfill.yml", import.meta.url),
  "utf8",
);
const cli = readFileSync(
  new URL("../../src/ingestion/cli/grade-cut-backfill.ts", import.meta.url),
  "utf8",
);

describe("grade cut backfill live/fixture safety", () => {
  it("defaults workflow dispatch to live provider fetch and wires --live", () => {
    expect(workflow).toMatch(/live:\s*\n\s+type: boolean\n\s+default: true/);
    expect(workflow).toContain('description: Fetch the live provider source instead of offline fixtures');
    expect(workflow).toMatch(/inputs\.live.*==.*"true".*inputs\.mode.*publish/s);
    expect(workflow).toMatch(/args\+=\(--live\)/);
  });

  it("allows offline fixture mode only when explicitly selected", () => {
    expect(resolveGradeCutFetcherMode({ mode: "dry-run", live: true })).toBe("live");
    expect(resolveGradeCutFetcherMode({ mode: "dry-run", live: false })).toBe("fixture");
    expect(cli).toContain('new FixtureFetcher(fixtureRoutes, process.cwd())');
    expect(cli).toContain('fetchMode === "fixture"');
  });

  it("requires live mode for publish and never selects fixture fetcher", () => {
    expect(() => resolveGradeCutFetcherMode({ mode: "publish", live: false })).toThrow(
      /fixture data cannot be published/,
    );
    expect(resolveGradeCutFetcherMode({ mode: "publish", live: true })).toBe("live");
    expect(cli).toContain('if (publish) {');
    expect(cli).toContain('if (publish) {\n      for (const value of normalized)');
  });

  it("does not persist in dry-run mode", () => {
    expect(cli).toContain('if (publish) {\n      for (const value of normalized)');
    expect(cli).toContain('mode: publish ? "publish" : live ? "live-dry-run" : "fixture-dry-run"');
  });
});
