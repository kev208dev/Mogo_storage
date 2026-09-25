/**
 * 실제 공식 사이트 대상 health check (live). CI 기본 테스트에서는 실행하지 않는다.
 *   npm run ingest:health -- [--source=ebsi] [--strict]
 * --strict: structure_changed 가 있으면 exit 1 (기본은 결과만 출력하고 0)
 * 결과는 꺼져 있는 source 도 그대로 기록한다 — "최근 health check 통과"가 source 활성화 조건이다.
 */
import { createDb } from "../../db/client";
import { recordHealthCheck, syncBuiltinSources, loadSources } from "../pipeline/sources";
import { BUILTIN_SOURCES } from "../sources/config";
import { createAdapter } from "../sources/registry";
import type { SourceConfig } from "../types";
import { listArg, parseArgs } from "./args";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const only = listArg(args.source);
  const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL, 2) : null;
  let sources: SourceConfig[] = BUILTIN_SOURCES;
  if (db) {
    await syncBuiltinSources(db);
    sources = await loadSources(db);
  }
  // health check 는 disabled source 도 실제로 확인한다 (enable 전 검증 용도)
  const targets = sources
    // 운영자 입력 source 는 자동 요청 대상이 아니다
    .filter((s) => s.kind !== "other_official")
    .filter((s) => !only || only.includes(s.id))
    .map((s) => ({ ...s, enabled: true }));
  let broken = 0;
  for (const source of targets) {
    const health = await createAdapter(source).healthCheck();
    if (health.status === "structure_changed") broken += 1;
    console.log(`${source.id.padEnd(18)} ${health.status.padEnd(9)} ${health.message}`);
    if (db) await recordHealthCheck(db, source.id, health);
  }
  if (db) await db.$client.end({ timeout: 5 });
  if (args.strict && broken > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(args().strict ? 1 : 0);
});
function args() {
  return parseArgs(process.argv.slice(2));
}
