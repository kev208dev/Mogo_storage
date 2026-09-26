/**
 * 복원한 DB 검증 (읽기 전용). backup/PITR 복구 후 서비스에 연결하기 전에 실행한다.
 *   DATABASE_URL=<복원 DB> npm run ops:restore-verify [-- --min-exams=1000 --min-files=10000]
 *
 * 확인: migration 적용 수 · 핵심 테이블 행 수 · 게시 파일 URL 정합성 · 샘플 데이터 섞임 · 고아 행.
 * 연결 문자열과 secret 은 출력하지 않는다. 문제가 있으면 exit 1.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { OFFICIAL_URL_HOSTS } from "../src/ingestion/manual-import/schema";
import { isHostAllowed } from "../src/ingestion/net/url-policy";
import { parseArgs, intArg } from "../src/ingestion/cli/args";

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL 이 필요합니다 (복원한 DB)");
    process.exit(2);
  }
  const args = parseArgs(process.argv.slice(2));
  const minExams = intArg(args["min-exams"]) ?? 1;
  const minFiles = intArg(args["min-files"]) ?? 1;
  const db = createDb(url, 1);
  const checks: Check[] = [];
  const count = async (query: ReturnType<typeof sql>) =>
    Number(((await db.execute(query)) as unknown as Array<{ n: string }>)[0]?.n ?? 0);
  try {
    const journal = JSON.parse(
      readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    const applied = await count(sql`select count(*) as n from drizzle.__drizzle_migrations`).catch(
      () => -1,
    );
    checks.push({
      name: "migrations",
      ok: applied === journal.entries.length,
      detail: `적용 ${applied} / 코드 ${journal.entries.length}${applied < journal.entries.length ? " — npm run db:migrate:prod 필요" : ""}`,
    });

    const exams = await count(sql`select count(*) as n from exams where is_sample = false`);
    const samples = await count(sql`select count(*) as n from exams where is_sample = true`);
    const files = await count(sql`select count(*) as n from exam_files`);
    const artifacts = await count(sql`select count(*) as n from source_artifacts`);
    checks.push({
      name: "exams",
      ok: exams >= minExams,
      detail: `실제 시험 ${exams} (기준 ≥ ${minExams}) · 샘플 ${samples}`,
    });
    checks.push({
      name: "exam_files",
      ok: files >= minFiles,
      detail: `게시 파일 ${files} (기준 ≥ ${minFiles}) · source_artifacts ${artifacts}`,
    });

    // redirect 파일은 https 공식 도메인만
    const redirects = (await db.execute(
      sql`select external_url from exam_files where delivery_type = 'redirect'`,
    )) as unknown as Array<{ external_url: string | null }>;
    const badRedirects = redirects.filter((r) => {
      try {
        const u = new URL(r.external_url ?? "");
        return u.protocol !== "https:" || !isHostAllowed(u.hostname, [...OFFICIAL_URL_HOSTS]);
      } catch {
        return true;
      }
    }).length;
    checks.push({
      name: "redirect_urls",
      ok: badRedirects === 0,
      detail: `redirect ${redirects.length}건 중 비공식/비https ${badRedirects}건`,
    });
    const storageWithoutKey = await count(
      sql`select count(*) as n from exam_files where delivery_type = 'storage' and storage_key is null`,
    );
    checks.push({
      name: "storage_keys",
      ok: storageWithoutKey === 0,
      detail: `storage 파일 중 key 없음 ${storageWithoutKey}건`,
    });
    // 실제 시험에 샘플 파일이 섞였는가 (샘플 파일은 source_artifact 가 없다)
    const mixed = await count(sql`
      select count(*) as n from exam_files f join exams e on e.id = f.exam_id
      where e.is_sample = false and f.source_artifact_id is null and f.delivery_type = 'storage'
        and f.original_file_name like '[샘플]%'`);
    checks.push({
      name: "sample_mix",
      ok: mixed === 0,
      detail: `실제 시험의 샘플 파일 ${mixed}건`,
    });
    const orphanArtifacts = await count(sql`
      select count(*) as n from source_artifacts a left join exams e on e.id = a.exam_id
      where a.exam_id is not null and e.id is null`);
    checks.push({
      name: "orphans",
      ok: orphanArtifacts === 0,
      detail: `시험 없는 source_artifacts ${orphanArtifacts}건`,
    });
  } finally {
    await db.$client.end({ timeout: 5 });
  }
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(14)} ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  console.log(
    failed.length
      ? `FAIL (${failed.length})`
      : "PASS — 이어서 npm run ingest:audit 로 슬롯 무결성을 확인하세요",
  );
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
