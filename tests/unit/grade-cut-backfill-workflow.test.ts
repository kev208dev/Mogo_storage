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
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("grade cut backfill live/fixture safety", () => {
  it("defaults workflow dispatch to live provider fetch and wires the explicit fetch mode", () => {
    expect(workflow).toMatch(/live:\s*\n\s+type: boolean\n\s+default: true/);
    expect(workflow).toContain(
      "description: Fetch the live provider source instead of offline fixtures",
    );
    expect(workflow).toContain("inputs.live");
    expect(workflow).toContain("inputs.mode");
    expect(workflow).toContain("args+=(--live)");
    expect(workflow).toContain("args+=(--fixture)");
    expect(ci).toContain("--dry-run --fixture");
  });

  it("requires an explicit live or fixture choice for dry-run", () => {
    expect(resolveGradeCutFetcherMode({ mode: "dry-run", live: true, fixture: false })).toBe(
      "live",
    );
    expect(resolveGradeCutFetcherMode({ mode: "dry-run", live: false, fixture: true })).toBe(
      "fixture",
    );
    expect(() =>
      resolveGradeCutFetcherMode({ mode: "dry-run", live: false, fixture: false }),
    ).toThrow(/exactly one/);
    expect(() =>
      resolveGradeCutFetcherMode({ mode: "dry-run", live: true, fixture: true }),
    ).toThrow(/exactly one/);
  });

  it("fixture fetcher can only be constructed in explicit fixture mode", () => {
    expect(cli).toContain('const fixture = process.argv.includes("--fixture")');
    expect(cli).toContain('source === "jongro" && fetchMode === "fixture"');
    expect(cli).toContain('createJongroAdapter(new FixtureFetcher(fixtureRoutes, process.cwd()))');
  });

  it("requires live mode for publish and prevents fixture persistence", () => {
    expect(() =>
      resolveGradeCutFetcherMode({ mode: "publish", live: false, fixture: true }),
    ).toThrow(/fixture data cannot be published/);
    expect(() =>
      resolveGradeCutFetcherMode({ mode: "publish", live: true, fixture: true }),
    ).toThrow(/fixture data cannot be published/);
    expect(resolveGradeCutFetcherMode({ mode: "publish", live: true, fixture: false })).toBe(
      "live",
    );
    expect(cli).toContain('if (publish) {\n      for (const value of normalized)');
    expect(cli).toContain("INGESTION_DATABASE_URL is required before publish mode starts");
    expect(workflow).toContain("INGESTION_DATABASE_URL is required for publish.");
  });

  it("dry-run reports zero persistence because writes are publish-gated", () => {
    expect(cli).toContain("let persisted = 0;");
    expect(cli).toContain('if (publish) {\n      for (const value of normalized)');
    expect(cli).toContain("persisted,");
  });
});
