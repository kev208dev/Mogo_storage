/**
 * 수집 coverage 보고서.
 *   npm run ingest:coverage -- [--year=2025] [--grade=2] [--from=2015 --to=2026] [--json] [--include-sample]
 */
import type { Grade } from "../../lib/constants";
import { computeCoverage, formatCoverage } from "../coverage";
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
    console.log(args.json ? JSON.stringify(report, null, 2) : formatCoverage(report));
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
