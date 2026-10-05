/**
 * 독해 학습 노트 입력 (검토 대기로 들어간다 — 공개는 /admin/study 에서 승인 · 게시 후).
 *   npm run study:import-notes -- --file=data/study/2026-09-g3.json [--dry-run]
 */
import { readFile } from "node:fs/promises";
import { importReadingNotes, readingNoteFileSchema } from "../study/reading-notes";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.file !== "string") throw new Error("--file=<notes.json> 이 필요합니다");
  const parsed = readingNoteFileSchema.parse(JSON.parse(await readFile(args.file, "utf8")));
  const db = requireDb();
  try {
    const result = await importReadingNotes(db, parsed.notes, { dryRun: args["dry-run"] === true });
    console.log(JSON.stringify({ dryRun: args["dry-run"] === true, ...result }));
  } finally {
    await closeDb(db);
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
