import type { ExamFile } from "../data/types";
import type { StorageProvider } from "./types";

export type DeliveryResolution =
  | { kind: "redirect"; url: string }
  | { kind: "unavailable"; reason: "missing_storage_key" | "missing_external_url" | "invalid_url" };

/**
 * exam_files 한 건을 실제 다운로드 URL 로 해석한다.
 *  - storage  → StorageProvider (R2 signed URL / CDN / mock)
 *  - redirect → 수집 단계에서 검증된 공식 원본 URL (http/https 만)
 * 화면은 이 구분을 몰라도 되고, 항상 /api/files/{id}/download 만 사용한다.
 */
export async function resolveFileDelivery(
  file: Pick<
    ExamFile,
    "deliveryType" | "storageKey" | "externalUrl" | "mimeType" | "originalFileName"
  >,
  mode: "view" | "download",
  storage: StorageProvider,
): Promise<DeliveryResolution> {
  if (file.deliveryType === "redirect") {
    if (!file.externalUrl) return { kind: "unavailable", reason: "missing_external_url" };
    try {
      const url = new URL(file.externalUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return { kind: "unavailable", reason: "invalid_url" };
      }
      return { kind: "redirect", url: url.toString() };
    } catch {
      return { kind: "unavailable", reason: "invalid_url" };
    }
  }
  if (!file.storageKey) return { kind: "unavailable", reason: "missing_storage_key" };
  const target = {
    storageKey: file.storageKey,
    mimeType: file.mimeType,
    originalFileName: file.originalFileName,
  };
  const url =
    mode === "download" ? await storage.getDownloadUrl(target) : await storage.getFileUrl(target);
  return { kind: "redirect", url };
}
