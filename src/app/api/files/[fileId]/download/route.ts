import { redirectToFile } from "@/lib/server/file-redirect";

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[fileId]/download">) {
  const { fileId } = await ctx.params;
  return redirectToFile(fileId, "download");
}
