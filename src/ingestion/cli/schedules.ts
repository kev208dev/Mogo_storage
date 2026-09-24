/**
 * 공식 발표로 확인된 시험 일정 등록 (idempotent). 시험 전 페이지도 함께 생성된다.
 *   npm run ingest:schedules -- --file=data/schedules/2027.json
 */
import { readFile } from "node:fs/promises";
import { scheduleFileSchema, upsertSchedule } from "../schedule/schedules";
import { syncBuiltinSources } from "../pipeline/sources";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.file !== "string") throw new Error("--file=<schedules.json> 이 필요합니다");
  const parsed = scheduleFileSchema.parse(JSON.parse(await readFile(args.file, "utf8")));
  const db = requireDb();
  try {
    await syncBuiltinSources(db);
    for (const s of parsed.schedules) {
      const row = await upsertSchedule(db, s);
      console.log(`✓ ${row.year} 고${row.grade} ${row.month}월 (${row.examType}) ${row.examDate}`);
    }
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
