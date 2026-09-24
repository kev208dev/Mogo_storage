import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCronAuth } from "@/lib/server/cron-auth";

const bodySchema = z.object({
  paths: z
    .array(z.string().regex(/^\/(exam|grade|year)\/[\w/-]+$|^\/$/))
    .min(1)
    .max(50),
});

/** CLI/외부 worker 가 자료를 게시한 뒤 공개 페이지를 즉시 갱신하도록 호출한다 */
export async function POST(request: Request) {
  const auth = checkCronAuth(request);
  if (auth === "disabled") return new NextResponse("Not found", { status: 404 });
  if (auth === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid paths" }, { status: 400 });
  for (const path of new Set(parsed.data.paths)) revalidatePath(path);
  revalidatePath("/sitemap.xml");
  return NextResponse.json({ ok: true, revalidated: parsed.data.paths.length });
}
