/**
 * 운영 migration (drizzle-kit 없이 drizzle-orm migrator 로 drizzle/*.sql 적용). idempotent.
 *   DATABASE_URL=... npm run db:migrate:prod
 * 적용 후 코드 카탈로그(세부과목·시험 체제)와 기본 source 설정을 동기화한다
 * (직업탐구·제2외국어 course 는 새 enum 값 때문에 migration 이 아니라 이 단계에서 들어간다).
 */
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db/client";
import { syncBuiltinSources } from "../src/ingestion/pipeline/sources";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL 이 필요합니다");
    process.exit(2);
  }
  const db = createDb(url, 1);
  try {
    await migrate(db, { migrationsFolder: path.resolve("drizzle") });
    console.log("✓ migrations applied");
    await syncBuiltinSources(db);
    console.log("✓ course catalog + source defaults synced (existing operator settings kept)");
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
