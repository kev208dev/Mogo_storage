/**
 * 운영 DB(Supabase) pg_cron + pg_net scheduler 설치·상태·제거.
 *   npm run ops:db-scheduler -- --status
 *   npm run ops:db-scheduler -- --install      (DATABASE_URL, CRON_SECRET, INGESTION_SITE_URL 필요)
 *   npm run ops:db-scheduler -- --uninstall
 *
 * 비밀값은 출력하지 않는다. CRON_SECRET · 사이트 URL 은 Supabase Vault 에 저장되고
 * cron job SQL 에는 Vault 이름만 들어간다 (src/ingestion/ops/db-scheduler.ts).
 */
import postgres from "postgres";
import {
  DB_CRON_JOBS,
  dbSchedulerStatus,
  installDbScheduler,
  uninstallDbScheduler,
} from "../ops/db-scheduler";
import { parseArgs } from "./args";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL 이 필요합니다.");
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    if (args.install) {
      const siteUrl = process.env.INGESTION_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
      const cronSecret = process.env.CRON_SECRET ?? "";
      if (!siteUrl || !cronSecret) {
        console.error("INGESTION_SITE_URL(또는 NEXT_PUBLIC_SITE_URL)과 CRON_SECRET 이 필요합니다.");
        process.exit(2);
      }
      const result = await installDbScheduler(sql, { siteUrl, cronSecret });
      console.log(`설치됨: ${result.jobs.join(", ")}`);
      for (const j of DB_CRON_JOBS)
        console.log(`  ${j.name}  ${j.schedule}  → /api/cron/${j.task}`);
    } else if (args.uninstall) {
      const result = await uninstallDbScheduler(sql);
      console.log(`제거됨: ${result.removed.join(", ") || "(없음)"}`);
    }
    const status = await dbSchedulerStatus(sql);
    console.log(JSON.stringify(status, null, 1));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  // 오류 메시지에 연결 문자열이 섞일 수 있어 URL 형태는 가린다
  const message = e instanceof Error ? e.message : String(e);
  console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"));
  process.exit(1);
});
