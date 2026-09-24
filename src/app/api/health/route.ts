import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

/**
 * 공개 health check (load balancer / uptime monitor 용).
 * 민감정보(연결 문자열, 오류 메시지, source 상태)는 노출하지 않는다 — source 상세는 /admin 에서만.
 */
export async function GET() {
  const db = getDb();
  let database: "ok" | "unavailable" | "not_configured" = "not_configured";
  if (db) {
    try {
      await Promise.race([
        db.execute(sql`select 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
      database = "ok";
    } catch {
      database = "unavailable";
    }
  }
  const ok = database !== "unavailable";
  return NextResponse.json(
    { app: "ok", database },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
