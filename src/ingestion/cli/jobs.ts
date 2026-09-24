/** job queue 만 처리. npm run ingest:jobs -- [--limit=100] [--budget=60] */
import { runJobs } from "../jobs/worker";
import { intArg, parseArgs } from "./args";
import { closeDb, createCliContext, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  try {
    const result = await runJobs(createCliContext(db), {
      limit: intArg(args.limit) ?? 100,
      timeBudgetMs: (intArg(args.budget) ?? 60) * 1000,
    });
    console.log(result);
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
