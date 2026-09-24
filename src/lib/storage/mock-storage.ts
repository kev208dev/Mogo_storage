import type { StorageFile, StorageProvider } from "./types";

export const MOCK_STORAGE_ROUTE = "/api/mock-storage";

/**
 * 개발용 mock 스토리지. 실제 파일 대신 /api/mock-storage 가 placeholder 파일을 만들어 응답한다.
 * (실제 시험지 PDF/음원은 저장소에 포함하지 않는다.)
 */
export class MockStorageProvider implements StorageProvider {
  readonly name = "mock";

  async getFileUrl(file: StorageFile) {
    return this.url(file, "inline");
  }

  async getDownloadUrl(file: StorageFile) {
    return this.url(file, "attachment");
  }

  private url(file: StorageFile, disposition: "inline" | "attachment") {
    const key = file.storageKey.split("/").map(encodeURIComponent).join("/");
    const params = new URLSearchParams({ name: file.originalFileName, disposition });
    return `${MOCK_STORAGE_ROUTE}/${key}?${params.toString()}`;
  }
}
