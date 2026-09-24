/** 시험 당일 자료 공개 감시 1회 실행. npm run ingest:release-watch */
import { ingestionEnabled } from "../backfill";
import { runReleaseWatch } from "../watch";
import { closeDb, createCliContext, requireDb } from "./context";

async function main() {
  if (!ingestionEnabled()) {
    console.log("INGESTION_ENABLED=true 가 아니므로 건너뜁니다.");
    return;
  }
  const db = requireDb();
  try {
    console.log(JSON.stringify(await runReleaseWatch(createCliContext(db)), null, 2));
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
