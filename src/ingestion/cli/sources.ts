/**
 * source 설정 동기화/조회/토글.
 *   npm run ingest:sources                 # 코드 기본값을 DB 에 동기화하고 목록 출력
 *   npm run ingest:sources -- --enable=ebsi
 *   npm run ingest:sources -- --disable=ebsi
 *   npm run ingest:sources -- --matrix      # source × 기능 자동화 상태 (정책 근거 포함)
 */
import { loadSources, setSourceEnabled, syncBuiltinSources } from "../pipeline/sources";
import { SOURCE_FEATURES, sourceStatusMatrix } from "../sources/policy";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  try {
    await syncBuiltinSources(db);
    if (typeof args.enable === "string") await setSourceEnabled(db, args.enable, true);
    if (typeof args.disable === "string") await setSourceEnabled(db, args.disable, false);
    const sources = await loadSources(db);
    if (args.matrix) {
      const rows = sourceStatusMatrix(sources);
      console.table(
        rows.map((r) => ({
          source: r.source,
          ...Object.fromEntries(SOURCE_FEATURES.map((f) => [f, r.features[f]])),
        })),
      );
      for (const r of rows) for (const n of r.notes) console.log(`- ${r.source}: ${n}`);
      return;
    }
    console.table(
      sources.map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        policy: s.deliveryPolicy,
        minPoll: s.minPollIntervalSeconds,
      })),
    );
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
