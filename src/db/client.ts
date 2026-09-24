import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __mogoDb?: Database };

/** DATABASE_URL이 없으면 null을 돌려준다. (샘플 데이터 모드) */
export function getDb(): Database | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.__mogoDb) {
    const client = postgres(url, { max: 10, prepare: false });
    globalForDb.__mogoDb = drizzle(client, { schema });
  }
  return globalForDb.__mogoDb;
}
