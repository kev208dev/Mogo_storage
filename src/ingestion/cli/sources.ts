/**
 * source 설정 동기화/조회/토글.
 *   npm run ingest:sources                 # 코드 기본값을 DB 에 동기화하고 목록 출력
 *   npm run ingest:sources -- --enable=ebsi
 *   npm run ingest:sources -- --disable=ebsi
 */
import { loadSources, setSourceEnabled, syncBuiltinSources } from "../pipeline/sources";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = requireDb();
  try {
    await syncBuiltinSources(db);
    if (typeof args.enable === "string") await setSourceEnabled(db, args.enable, true);
    if (typeof args.disable === "string") await setSourceEnabled(db, args.disable, false);
    console.table(
      (await loadSources(db)).map((s) => ({
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
