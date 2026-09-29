export type GradeCutBackfillMode = "dry-run" | "publish";
export type GradeCutFetcherMode = "fixture" | "live";

export function resolveGradeCutFetcherMode(input: {
  mode: GradeCutBackfillMode;
  live: boolean;
  fixture: boolean;
}): GradeCutFetcherMode {
  if (input.mode === "publish") {
    if (!input.live || input.fixture) {
      throw new Error("publish requires --live; fixture data cannot be published");
    }
    return "live";
  }
  if (input.live === input.fixture) {
    throw new Error("dry-run requires exactly one of --live or --fixture");
  }
  return input.live ? "live" : "fixture";
}
