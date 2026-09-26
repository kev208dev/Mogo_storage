/**
 * 운영자가 브라우저에서 확인한 공식 파일 URL CSV 입력 (검토 대기로 저장, 게시는 /admin/imports 에서 승인).
 *   npm run import:official-urls -- --file=data/imports/2025.csv --admin=ops@example.com [--dry-run]
 *     [--evidence=<근거 JSON>]   import 뒤 근거·보류 사유를 붙인다 (import:candidates 결과 또는 브라우저 검증 기록)
 *   npm run import:official-urls -- --evidence=<근거 JSON> --admin=ops@example.com   (근거만 붙이기)
 * 서버는 URL 에 요청하지 않는다 (형식·공식 도메인만 검사). 같은 파일을 다시 넣어도 중복이 생기지 않는다.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { attachEvidence, parseEvidenceFile } from "../manual-import/attach";
import { importOfficialUrls } from "../manual-import/import";
import { syncBuiltinSources } from "../pipeline/sources";
import { parseArgs } from "./args";
import { closeDb, requireDb } from "./context";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.file !== "string" && typeof args.evidence !== "string")
    throw new Error("--file=<csv> 또는 --evidence=<근거 JSON> 이 필요합니다");
  if (typeof args.admin !== "string" || !args.admin.includes("@"))
    throw new Error("--admin=<입력한 운영자 이메일> 이 필요합니다 (감사 기록)");
  const db = requireDb();
  try {
    if (typeof args.file !== "string") {
      await attachEvidenceFile(db, args.evidence as string, args.admin);
      return;
    }
    const csv = await readFile(args.file, "utf8");
    await syncBuiltinSources(db); // 세부과목 카탈로그 보장
    const result = await importOfficialUrls(db, {
      csv,
      admin: args.admin,
      fileName: path.basename(args.file),
      dryRun: Boolean(args["dry-run"]),
    });
    const c = result.counts;
    console.log(
      result.dryRun
        ? `[dry-run] 검사 통과 ${c.unchanged} · 오류 ${c.invalid} (DB 에 쓰지 않음)`
        : `신규 ${c.created} · 변경 ${c.updated} · 동일 ${c.unchanged} · 오류 ${c.invalid}`,
    );
    for (const r of result.rows.filter((x) => x.status === "invalid"))
      console.log(`  ${r.line}행: ${r.errors?.join("; ")}`);
    if (!result.dryRun && typeof args.evidence === "string")
      await attachEvidenceFile(db, args.evidence, args.admin);
    if (!result.dryRun)
      console.log("→ /admin/imports 에서 브라우저로 확인 후 승인하면 게시됩니다.");
    if (c.invalid) process.exitCode = 1;
  } finally {
    await closeDb(db);
  }
}

async function attachEvidenceFile(db: ReturnType<typeof requireDb>, file: string, admin: string) {
  const entries = parseEvidenceFile(JSON.parse(await readFile(file, "utf8")));
  const { attached, unmatched } = await attachEvidence(db, entries, admin);
  console.log(`근거 연결 ${attached}건 · DB 에 없는 URL ${unmatched.length}건`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
