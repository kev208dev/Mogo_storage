export type GradeCutBackfillMode = "dry-run" | "publish";
export type GradeCutFetcherMode = "fixture" | "live";

export function resolveGradeCutFetcherMode(input: {
  mode: GradeCutBackfillMode;
  live: boolean;
}): GradeCutFetcherMode {
  if (input.mode === "publish" && !input.live) {
    throw new Error("publish requires --live; fixture data cannot be published");
  }
  return input.live ? "live" : "fixture";
}
