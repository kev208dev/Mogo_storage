"use server";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/server/admin-session";
import { importOfficialUrls } from "@/ingestion/manual-import/import";
export async function previewOfficialCsv(csv: string) {
  const admin = await requireAdmin();
  if (csv.length > 2_000_000) return { error: "CSV 는 2MB 이하로 입력하세요", rows: [] };
  const db = getDb();
  if (!db) return { error: "DB 연결 없음", rows: [] };
  try {
    const result = await importOfficialUrls(db, { csv, admin, dryRun: true });
    return { error: "", rows: result.rows };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "검사 실패", rows: [] };
  }
}
