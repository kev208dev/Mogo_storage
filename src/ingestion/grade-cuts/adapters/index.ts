import type { GradeCutAdapter } from "../core";
import { megaStudyAdapter } from "./megastudy";

/**
 * Register only adapters backed by a captured public page, a fixture and a
 * verified exam/course mapping. A marketing page alone is not a data adapter.
 */
export const verifiedGradeCutAdapters: readonly GradeCutAdapter[] = [megaStudyAdapter];
