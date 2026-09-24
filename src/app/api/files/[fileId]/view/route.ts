import { redirectToFile } from "@/lib/server/file-redirect";

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[fileId]/view">) {
  const { fileId } = await ctx.params;
  return redirectToFile(fileId, "view");
}
