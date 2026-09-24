/** 정기 수집 1회 실행 (Linux cron / GitHub Actions / 수동). npm run ingest:scheduled */
import { runScheduledIngestion } from "../watch";
import { syncBuiltinSources } from "../pipeline/sources";
import { closeDb, createCliContext, requireDb } from "./context";

async function main() {
  const db = requireDb();
  try {
    await syncBuiltinSources(db);
    const result = await runScheduledIngestion(createCliContext(db));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
