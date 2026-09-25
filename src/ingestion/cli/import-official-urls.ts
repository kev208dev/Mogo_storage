/**
 * 운영자가 브라우저에서 확인한 공식 파일 URL CSV 입력 (검토 대기로 저장, 게시는 /admin/imports 에서 승인).
 *   npm run import:official-urls -- --file=data/imports/2025.csv --admin=ops@example.com [--dry-run]
 * 서버는 URL 에 요청하지 않는다 (형식·공식 도메인만 검사). 같은 파일을 다시 넣어도 중복이 생기지 않는다.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { importOfficialUrls } from "../manual-import/import";
import { syncBuiltinSources } from "../pipeline/sources";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.file !== "string") throw new Error("--file=<csv> 가 필요합니다");
  if (typeof args.admin !== "string" || !args.admin.includes("@"))
    throw new Error("--admin=<입력한 운영자 이메일> 이 필요합니다 (감사 기록)");
  const csv = await readFile(args.file, "utf8");
  const db = requireDb();
  try {
    await syncBuiltinSources(db); // 세부과목 카탈로그 보장
    const result = await importOfficialUrls(db, {
      csv,
      admin: args.admin,
      fileName: path.basename(args.file),
      dryRun: Boolean(args["dry-run"]),
    });
    const c = result.counts;
    console.log(
      `${result.dryRun ? "[dry-run] " : ""}신규 ${c.created} · 변경 ${c.updated} · 동일 ${c.unchanged} · 오류 ${c.invalid}`,
    );
    for (const r of result.rows.filter((x) => x.status === "invalid"))
      console.log(`  ${r.line}행: ${r.errors?.join("; ")}`);
    if (!result.dryRun)
      console.log("→ /admin/imports 에서 브라우저로 확인 후 승인하면 게시됩니다.");
    if (c.invalid) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
