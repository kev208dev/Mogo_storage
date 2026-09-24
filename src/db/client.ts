import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

const globalForDb = globalThis as unknown as { __mogoDb?: Database };

/** 지정한 URL 로 새 연결을 만든다 (CLI, 통합 테스트용) */
export function createDb(url: string, max = 10): Database {
  const client = postgres(url, { max, prepare: false, onnotice: () => {} });
  return drizzle(client, { schema }) as Database;
}

/** DATABASE_URL이 없으면 null을 돌려준다. (샘플 데이터 모드) */
export function getDb(): Database | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  globalForDb.__mogoDb ??= createDb(url);
  return globalForDb.__mogoDb;
}
