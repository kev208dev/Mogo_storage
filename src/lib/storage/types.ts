import type { ExamFile } from "../data/types";

export type StorageFile = Pick<ExamFile, "storageKey" | "mimeType" | "originalFileName">;

/**
 * 파일 스토리지 추상화.
 * 앱 코드는 이 인터페이스만 사용하고, 실제 구현(mock / Cloudflare R2)은 환경변수로 선택한다.
 */
export interface StorageProvider {
  readonly name: string;
  /** 브라우저에서 바로 열어볼 수 있는 URL (미리보기, 오디오 재생) */
  getFileUrl(file: StorageFile): Promise<string>;
  /** 다운로드(Content-Disposition: attachment) URL */
  getDownloadUrl(file: StorageFile): Promise<string>;
}

/** RFC 6266 / RFC 5987 Content-Disposition (한글 파일명 지원) */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

export function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
