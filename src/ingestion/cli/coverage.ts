/**
 * 수집 coverage 보고서.
 *   npm run ingest:coverage -- [--year=2025] [--grade=2] [--from=2015 --to=2026] [--json] [--include-sample]
 *   npm run ingest:coverage -- --summary        # 연도별 · 학년별 · 자료 종류별 게시/대기/실패/누락 수
 */
import type { Grade } from "../../lib/constants";
import {
  computeCoverage,
  formatCoverage,
  formatCoverageSummary,
  summarizeCoverage,
} from "../coverage";
import { intArg, parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  try {
    const report = await computeCoverage(db, {
      year: intArg(args.year),
      grade: intArg(args.grade) as Grade | undefined,
      fromYear: intArg(args.from),
      toYear: intArg(args.to),
      includeSample: Boolean(args["include-sample"]),
    });
    const summary = summarizeCoverage(report);
    if (args.json) console.log(JSON.stringify({ ...report, summary }, null, 2));
    else if (args.summary) console.log(formatCoverageSummary(summary));
    else console.log(`${formatCoverage(report)}\n\n${formatCoverageSummary(summary)}`);
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
