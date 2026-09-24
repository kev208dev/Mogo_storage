/**
 * 과거 모의고사 일괄 구축.
 *   npm run ingest:backfill -- --dry-run                     # DB/네트워크 없이 구조 확인 (fixture)
 *   npm run ingest:backfill -- --source=ebsi --from=2015 --to=2026
 *   npm run ingest:backfill -- --year=2025 --grade=2 [--force] [--no-jobs]
 *   npm run ingest:backfill -- --source=ebsi --from=2025 --to=2026 --metadata-only
 *
 * 단계(canary): 최근 1년 → audit 통과 → 최근 3년 → audit 통과 → 전체.
 *   더 넓은 범위는 앞 단계의 `npm run ingest:audit -- --record` 통과 기록이 있어야 실행된다.
 * --metadata-only: 시험 · 영역 · SourceExam · 공식 자료 URL 까지만 (파일 검증/다운로드/게시 안 함)
 */
import type { Grade } from "../../lib/constants";
import { runBackfill, ingestionEnabled } from "../backfill";
import { syncBuiltinSources } from "../pipeline/sources";
import { parseArgs, intArg, listArg } from "./args";
import { closeDb, createCliContext, requireDb } from "./context";
import { dryRunBackfill } from "./dry-run";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const year = intArg(args.year);
  const now = new Date().getFullYear();
  const fromYear = year ?? intArg(args.from) ?? (args["dry-run"] ? 2025 : now - 1);
  const toYear = year ?? intArg(args.to) ?? (args["dry-run"] ? 2025 : now);
  const grade = intArg(args.grade) as Grade | undefined;
  if (grade !== undefined && ![1, 2, 3].includes(grade)) throw new Error("--grade 는 1~3");
  const sourceIds = listArg(args.source);

  if (args["dry-run"]) {
    const live = Boolean(args.live) && ingestionEnabled();
    await dryRunBackfill({ sourceIds, fromYear, toYear, grade, live });
    return;
  }
  if (!ingestionEnabled()) {
    console.error(
      "INGESTION_ENABLED=true 가 아니면 실제 수집을 실행하지 않습니다. (--dry-run 으로 구조 확인 가능)",
    );
    process.exit(2);
  }
  const db = requireDb();
  try {
    await syncBuiltinSources(db);
    const ctx = createCliContext(db);
    const { results, jobs } = await runBackfill(ctx, {
      sourceIds,
      fromYear,
      toYear,
      grades: grade ? [grade] : undefined,
      force: Boolean(args.force),
      runJobs: !args["no-jobs"],
      metadataOnly: Boolean(args["metadata-only"]),
    });
    console.table(
      results.map((r) => ({ source: r.source, scope: r.scope, status: r.status, ...r.counts })),
    );
    for (const r of results.filter((x) => x.message)) console.log(`${r.source}: ${r.message}`);
    if (jobs) console.log("jobs:", jobs);
    if (results.length === 0)
      console.log("실행할 source 가 없습니다. (--source 지정 또는 source enable 필요)");
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
