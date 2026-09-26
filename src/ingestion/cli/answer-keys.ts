/**
 * 공식 정답·해설 PDF → 정답표 추출 · 검증 (· 게시).
 *   npm run answers:extract -- [--year=2025] [--exam=<id>] [--limit=20] [--dry-run] [--publish] [--force]
 *
 * - 정책상 파일 요청이 허용된 호스트(EBSi 파일 서버)만 SafeFetcher 로 받는다 (요청 간격 · redirect 재검증 · 사설 IP 차단).
 * - 결과는 answer_key_extractions 에 슬롯별로 남는다. --publish 가 있어야 검증된 슬롯만 questions 에 게시한다.
 * - 같은 파서 버전으로 처리한 시험·영역은 건너뛴다 (--force 로 다시).
 */
import { ANSWER_KEY_PARSER_VERSION } from "../answer-keys/assemble";
import { runAnswerKeyExtraction } from "../answer-keys/extract";
import { createUrlCheckFetcher } from "../manual-import/url-check";
import { intArg, parseArgs } from "./args";
import { closeDb, createCliContext, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  const ctx = createCliContext(db);
  try {
    const summary = await runAnswerKeyExtraction(ctx, createUrlCheckFetcher(), {
      year: intArg(args.year),
      examId: typeof args.exam === "string" ? args.exam : undefined,
      limit: intArg(args.limit),
      dryRun: Boolean(args["dry-run"]),
      publish: Boolean(args.publish),
      force: Boolean(args.force),
    });
    console.log(JSON.stringify({ parserVersion: ANSWER_KEY_PARSER_VERSION, ...summary }, null, 1));
    if (summary.failures.length) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
