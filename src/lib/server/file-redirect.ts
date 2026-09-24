import "server-only";
import { getRepository } from "@/lib/data";
import type { ExamFile } from "@/lib/data/types";
import { getStorageProvider } from "@/lib/storage";
import { resolveFileDelivery } from "@/lib/storage/delivery";

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * 다운로드 링크를 직접 연 사용자에게 보여줄 최소 HTML 오류 페이지.
 * 내부 오류 상세(stack, provider 메시지)는 절대 포함하지 않는다.
 */
export function fileErrorResponse(status: 404 | 502 | 503, title: string, body: string) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} | 모의고사 창고</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#18181b"><p style="color:#1d4ed8;font-weight:600;margin:0">${status}</p><h1 style="font-size:1.25rem;margin:.25rem 0 .5rem">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><p><a href="javascript:history.back()">이전 페이지로</a> · <a href="/">홈으로</a></p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

const NOT_FOUND = () =>
  fileErrorResponse(
    404,
    "파일을 찾을 수 없습니다",
    "요청한 자료가 존재하지 않거나 삭제되었습니다. 시험 페이지에서 다시 선택해 주세요.",
  );

/**
 * 파일 id → 스토리지 URL 또는 검증된 공식 원본 URL 로 302 redirect.
 * 중간 페이지 없이 바로 파일로 연결된다. (R2 signed URL 은 매번 바뀌므로 redirect 자체는 캐시하지 않는다)
 *
 * 상태 구분:
 *  - 404: 파일 metadata 없음 (자료 준비 중인 슬롯은 화면에서 링크 자체가 비활성화된다)
 *  - 503: 파일 정보를 조회하지 못함 (DB 장애 등)
 *  - 502: 스토리지(R2 등) URL 생성 실패
 */
export async function redirectToFile(fileId: string, mode: "view" | "download") {
  if (!FILE_ID_PATTERN.test(fileId)) return NOT_FOUND();

  let file: ExamFile | null;
  try {
    file = await getRepository().getFile(fileId);
  } catch (error) {
    console.error("[file-redirect] lookup failed", fileId, error);
    return fileErrorResponse(
      503,
      "지금은 다운로드할 수 없습니다",
      "일시적인 오류로 파일 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
  if (!file) return NOT_FOUND();

  try {
    const resolved = await resolveFileDelivery(file, mode, getStorageProvider());
    if (resolved.kind === "unavailable") {
      console.error("[file-redirect] unavailable", fileId, resolved.reason);
      return fileErrorResponse(
        502,
        "오류로 다운로드할 수 없습니다",
        "자료 정보에 문제가 있어 다운로드할 수 없습니다. 시험 페이지의 [오류 신고]로 알려주세요.",
      );
    }
    return new Response(null, {
      status: 302,
      headers: { location: resolved.url, "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  } catch (error) {
    console.error("[file-redirect] storage failed", fileId, error);
    return fileErrorResponse(
      502,
      "오류로 다운로드할 수 없습니다",
      "파일 서버에 연결하지 못했습니다. 잠시 후 다시 시도하고, 문제가 계속되면 시험 페이지의 [오류 신고]로 알려주세요.",
    );
  }
}
