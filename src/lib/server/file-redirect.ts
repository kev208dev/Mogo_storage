import "server-only";
import { getRepository } from "@/lib/data";
import { getStorageProvider } from "@/lib/storage";

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function htmlError(status: number, title: string, body: string) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.6"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p><p><a href="javascript:history.back()">이전 페이지로</a> · <a href="/">홈으로</a></p></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * 파일 id → 스토리지 URL 로 302 redirect.
 * 중간 페이지 없이 바로 파일로 연결된다. (R2 signed URL 은 매번 바뀌므로 redirect 자체는 캐시하지 않는다)
 */
export async function redirectToFile(fileId: string, mode: "view" | "download") {
  if (!FILE_ID_PATTERN.test(fileId)) {
    return htmlError(404, "파일을 찾을 수 없습니다", "요청한 자료가 존재하지 않습니다.");
  }
  const file = await getRepository().getFile(fileId);
  if (!file) {
    return htmlError(
      404,
      "파일을 찾을 수 없습니다",
      "자료가 삭제되었거나 아직 준비 중입니다. 시험 페이지에서 오류 신고를 남겨 주세요.",
    );
  }
  try {
    const storage = getStorageProvider();
    const url =
      mode === "download" ? await storage.getDownloadUrl(file) : await storage.getFileUrl(file);
    return new Response(null, {
      status: 302,
      headers: { location: url, "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  } catch (error) {
    console.error("[file-redirect]", fileId, error);
    return htmlError(
      502,
      "파일 서버에 연결하지 못했습니다",
      "잠시 후 다시 시도해 주세요. 문제가 계속되면 오류 신고를 남겨 주세요.",
    );
  }
}
