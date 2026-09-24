import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertSafeStorageKey,
  type PutObjectInput,
  type StorageFile,
  type StorageProvider,
} from "./types";

export const MOCK_STORAGE_ROUTE = "/api/mock-storage";

/** 로컬 개발용 저장 위치: <프로젝트>/.data/mock-storage (.gitignore 대상, 경로를 정적으로 고정) */
export async function readMockObject(key: string): Promise<Uint8Array | null> {
  assertSafeStorageKey(key);
  try {
    return new Uint8Array(await readFile(path.join(process.cwd(), ".data", "mock-storage", key)));
  } catch {
    return null;
  }
}

/**
 * 개발용 mock 스토리지. putObject 로 저장된 파일은 로컬 디스크(.data/mock-storage)에서,
 * 그 외에는 /api/mock-storage 가 placeholder 파일을 만들어 응답한다.
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

  async putObject(input: PutObjectInput) {
    assertSafeStorageKey(input.key);
    const target = path.join(process.cwd(), ".data", "mock-storage", input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
  }

  private url(file: StorageFile, disposition: "inline" | "attachment") {
    const key = file.storageKey.split("/").map(encodeURIComponent).join("/");
    const params = new URLSearchParams({ name: file.originalFileName, disposition });
    return `${MOCK_STORAGE_ROUTE}/${key}?${params.toString()}`;
  }
}
