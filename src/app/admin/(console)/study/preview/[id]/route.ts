import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { studyMaterials } from "@/db/schema";
import { requireAdmin } from "@/lib/server/admin-session";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** 관리자 전용: 게시 전 학습지 PDF 미리보기 (스토리지 URL 로 302, 파일을 서버로 중계하지 않는다) */
export async function GET(_req: Request, { params }: RouteContext<"/admin/study/preview/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const db = getDb();
  if (!db || !/^[\w-]{1,100}$/.test(id)) return new Response("not found", { status: 404 });
  const [m] = await db.select().from(studyMaterials).where(eq(studyMaterials.id, id));
  if (!m?.storageKey) return new Response("not found", { status: 404 });
  const url = await getStorageProvider().getFileUrl({
    storageKey: m.storageKey,
    mimeType: m.mimeType ?? "application/pdf",
    originalFileName: m.fileName ?? "worksheet.pdf",
  });
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
