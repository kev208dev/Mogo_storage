export interface StorageFile {
  storageKey: string;
  mimeType: string;
  originalFileName: string;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  /** 무결성 확인용 (hex) */
  sha256?: string;
}

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
  /**
   * 파일 저장. 재배포가 허용된(mirror_allowed) 공식 자료와 우리가 생성한 자료(단어장 PDF)에만 사용한다.
   * 같은 key 로 여러 번 호출해도 결과가 같아야 한다 (idempotent).
   */
  putObject(input: PutObjectInput): Promise<void>;
}

/** 스토리지 key 로 쓸 수 있는 안전한 문자만 허용 (path traversal 방지) */
export function assertSafeStorageKey(key: string): void {
  if (
    !/^[a-z0-9][a-z0-9/_.-]{0,300}$/i.test(key) ||
    key.includes("..") ||
    key.includes("//") ||
    key.endsWith("/")
  ) {
    throw new Error(`Unsafe storage key: ${JSON.stringify(key.slice(0, 80))}`);
  }
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
