/**
 * 이미 게시된 영어 공식 파일 → 단어/듣기 대본 추출 job backfill.
 *   npm run study:backfill -- --year=2026 [--exam=exam_2026_h3_09] [--dry-run] [--run-jobs]
 *
 * 생성 학습지는 관리자 승인 전에는 게시하지 않는다.
 */
import { backfillEnglishStudy } from "../study/backfill";
import { runJobs } from "../jobs/worker";
import { intArg, parseArgs } from "./args";
import { closeDb, createCliContext, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  try {
    const ctx = createCliContext(db);
    const summary = await backfillEnglishStudy(ctx, {
      year: intArg(args.year),
      examId: typeof args.exam === "string" ? args.exam : undefined,
      dryRun: Boolean(args["dry-run"]),
    });
    console.log(JSON.stringify(summary, null, 2));
    if (args["run-jobs"] && !args["dry-run"]) {
      const jobs = await runJobs(ctx, {
        limit: intArg(args.limit) ?? 50,
        timeBudgetMs: (intArg(args.budget) ?? 180) * 1000,
        // GitHub/운영 CLI에서 mock storage로 생성 학습지를 만들지 않는다.
        // 추출 작업만 실행하고 generate_study_materials는 실제 storage가 있는 worker에 남긴다.
        types: ["extract_vocabulary", "extract_listening_script"],
      });
      console.log(JSON.stringify({ jobs }, null, 2));
      if (jobs.failed > 0) process.exitCode = 1;
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
