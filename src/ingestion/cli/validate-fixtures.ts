/**
 * 저장된 실제 fixture(tests/fixtures/live)를 모든 adapter parser 에 통과시킨다. 네트워크를 쓰지 않아 CI 에서 실행된다.
 *   npm run ingest:fixtures:validate                # 검증만
 *   npm run ingest:fixtures:validate -- --json
 *   npm run ingest:fixtures:validate -- --record    # (DATABASE_URL) 결과를 exam_sources 에 증거로 기록
 * --record 는 "증거"만 남긴다. 자동 수집을 켜려면 관리자가 /admin 에서 검증 승인 후 source 를 켜야 한다.
 * 실패한 source 는 기존 승인도 취소되고 수집이 꺼진다.
 */
import { createDb } from "../../db/client";
import { validateLiveFixtures } from "../fixtures/live";
import { recordLiveFixtureEvidence, syncBuiltinSources } from "../pipeline/sources";
import { parseArgs } from "./args";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const only = typeof args.source === "string" ? args.source : undefined;
  const { results, summaries } = validateLiveFixtures(undefined, only);
  if (args.json) {
    console.log(
      JSON.stringify(
        { results: results.map(({ records: _r, ...rest }) => (void _r, rest)), summaries },
        null,
        2,
      ),
    );
  } else if (results.length === 0) {
    console.log("live fixture 없음 — 모든 source 가 '실제 구조 미검증' 상태입니다.");
    console.log(
      "실제 페이지에 접근 가능한 환경에서 npm run ingest:capture 로 fixture 를 저장하세요.",
    );
  } else {
    for (const r of results) {
      console.log(
        `${r.ok ? "✓" : "✗"} ${r.name}  exams=${r.exams} artifacts=${r.artifacts} ambiguousCourses=${r.ambiguousCourses}`,
      );
      for (const e of r.errors) console.log(`    - ${e}`);
    }
    for (const s of summaries) {
      console.log(
        `${s.passed ? "PASS" : "FAIL"} ${s.source} (${s.fixtures} fixtures, parser ${s.parserVersion})`,
      );
    }
  }
  if (args.record) {
    if (!process.env.DATABASE_URL) throw new Error("--record 에는 DATABASE_URL 이 필요합니다");
    const db = createDb(process.env.DATABASE_URL, 2);
    await syncBuiltinSources(db);
    for (const s of summaries) {
      await recordLiveFixtureEvidence(db, s.source, {
        passed: s.passed,
        fixtureHash: s.fixtureHash,
        parserVersion: s.parserVersion,
        at: new Date(),
      });
      console.log(
        `recorded ${s.source}: ${s.passed ? "evidence saved (관리자 승인 대기)" : "FAILED → 승인 취소, 수집 중지"}`,
      );
    }
    await db.$client.end({ timeout: 5 });
  }
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
