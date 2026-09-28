import type { GradeCutProvider, GradeCutProvenance } from "../provider-registry";
import type { WatchExam, WatchSlot } from "../core";
import type { GradeCutEntry } from "../../../lib/data/types";

export interface GradeCutAdapterCapabilities {
  grades: readonly (1 | 2 | 3)[];
  historical: boolean;
  firstParty: boolean;
  rangeCuts: boolean;
}

export interface DiscoveredGradeCut {
  exam: WatchExam;
  sourceUrl: string;
  externalId: string;
}

export interface ParsedProviderGradeCut {
  subject: WatchSlot["subject"];
  courseCode: string | null;
  cuts: GradeCutEntry[];
  provenance: GradeCutProvenance;
}

export interface UnifiedGradeCutAdapter {
  provider: GradeCutProvider;
  capabilities: GradeCutAdapterCapabilities;
  discover(exam: WatchExam): Promise<DiscoveredGradeCut[]>;
  fetch(candidate: DiscoveredGradeCut): Promise<string>;
  parse(candidate: DiscoveredGradeCut, body: string): ParsedProviderGradeCut[];
  validate(value: ParsedProviderGradeCut): void;
}
