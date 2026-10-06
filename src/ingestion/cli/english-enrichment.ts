/**
 * 이미 운영자가 브라우저로 검증·게시한 공식 영어 파일을 후처리한다.
 *
 * npm run english:enrich -- [--year=2026] [--grade=3] [--month=9] [--exam=<id>]
 *   [--limit=10] [--dry-run] [--enqueue-materials]
 *
 * 자동 discovery 는 하지 않는다. 게시된 official redirect 중 정책상 파일 요청이 허용된 호스트만
 * SafeFetcher 로 읽고, operator_import 는 verification_mode=operator_browser 인 자료만 처리한다.
 */
import { runEnglishEnrichment } from "../english/enrichment";
import { createUrlCheckFetcher } from "../manual-import/url-check";
import { intArg, parseArgs } from "./args";
import { closeDb, createCliContext, requireDb } from "./context";

function bounded(name: string, value: number | undefined, min: number, max: number) {
  if (value === undefined) return undefined;
  if (value < min || value > max) throw new Error(`--${name} 는 ${min}~${max}`);
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  const ctx = createCliContext(db);
  try {
    const summary = await runEnglishEnrichment(ctx, createUrlCheckFetcher(), {
      year: intArg(args.year),
      grade: bounded("grade", intArg(args.grade), 1, 3),
      month: bounded("month", intArg(args.month), 1, 12),
      examId: typeof args.exam === "string" ? args.exam : undefined,
      limit: intArg(args.limit),
      dryRun: Boolean(args["dry-run"]),
      enqueueMaterials: Boolean(args["enqueue-materials"]),
    });
    console.log(JSON.stringify(summary, null, 1));
    if (summary.failures.length) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
