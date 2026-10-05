/**
 * 공식 발표로 확인된 시험 일정 등록 (idempotent). 시험 전 페이지도 함께 생성된다.
 *   npm run ingest:schedules -- --file=data/schedules/2027.json --dry-run
 *   npm run ingest:schedules -- --file=data/schedules/2027.json
 *
 * 각 일정에는 공식 공지 URL(교육청 · 평가원 · 교육부, https)이 있어야 한다. 학원 · 언론 기사는 근거로 받지 않는다.
 * 시행일 변경은 changeNote, 취소는 cancelled + cancelledReason 으로 기록한다 (이전 날짜는 보존).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  planSchedule,
  scheduleFileSchema,
  upsertSchedule,
  validateManualSchedule,
} from "../schedule/schedules";
import { syncBuiltinSources } from "../pipeline/sources";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.file !== "string") throw new Error("--file=<schedules.json> 이 필요합니다");
  const dryRun = Boolean(args["dry-run"]);
  const parsed = scheduleFileSchema.parse(JSON.parse(await readFile(args.file, "utf8")));
  const invalid = parsed.schedules.flatMap((s) =>
    validateManualSchedule(s).map((e) => `${s.year} 고${s.grade} ${s.month}월: ${e}`),
  );
  if (invalid.length) throw new Error(`입력 오류:\n${invalid.join("\n")}`);
  const db = requireDb();
  try {
    if (!dryRun) await syncBuiltinSources(db);
    for (const s of parsed.schedules) {
      const label = `${s.year} 고${s.grade} ${s.month}월 (${s.examType}) ${s.examDate}`;
      const plan = await planSchedule(db, s);
      if (plan.action === "conflict") throw new Error(`${label}: ${plan.reason}`);
      if (dryRun) {
        console.log(
          `[dry-run] ${label}: ${plan.action}${"changes" in plan ? ` (${plan.changes.join(", ")})` : ""}`,
        );
        continue;
      }
      await upsertSchedule(db, s, { verifiedBy: `manual_json:${path.basename(args.file)}` });
      console.log(`✓ ${label}: ${plan.action}`);
    }
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
