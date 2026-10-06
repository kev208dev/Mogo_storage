/**
 * 이미 게시된 영어 자료를 단어장/듣기 대본/학습지 PROCESS 단계에 다시 연결한다.
 *
 *   npm run study:backfill -- --year=2026 --grade=3 --month=9 --dry-run
 *   npm run study:backfill -- --year=2026 --grade=3 --month=9 --process
 *
 * operator_import URL은 서버에서 다시 요청하지 않는 기존 정책을 유지한다.
 */
import { backfillEnglishStudy } from "../study/backfill";
import { runJobs } from "../jobs/worker";
import { intArg, parseArgs } from "./args";
import { closeDb, createCliContext, requireDb } from "./context";

function gradeArg(value: string | true | undefined): 1 | 2 | 3 | undefined {
  const n = intArg(value);
  if (n === undefined) return undefined;
  if (n !== 1 && n !== 2 && n !== 3) throw new Error("--grade=1|2|3");
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = intArg(args.year);
  const grade = gradeArg(args.grade);
  const month = intArg(args.month);
  if (year !== undefined && (year < 2000 || year > 2100)) throw new Error("--year 범위 오류");
  if (month !== undefined && (month < 1 || month > 12)) throw new Error("--month=1..12");
  const dryRun = args["dry-run"] === true;
  const runWorker = args.process === true;
  const limit = intArg(args.limit) ?? 200;
  const budgetSeconds = intArg(args.budget) ?? 300;

  const db = requireDb();
  try {
    const ctx = createCliContext(db);
    const result = await backfillEnglishStudy(ctx, { year, grade, month }, { dryRun });
    const output: Record<string, unknown> = { dryRun, filter: { year, grade, month }, ...result };

    if (runWorker && !dryRun) {
      output.worker = await runJobs(ctx, {
        limit,
        timeBudgetMs: budgetSeconds * 1000,
      });
    }
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await closeDb(db);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
