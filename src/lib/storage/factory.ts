import { MockStorageProvider } from "./mock-storage";
import { R2StorageProvider } from "./r2-storage";
import type { StorageProvider } from "./types";

let provider: StorageProvider | undefined;

/** server-only 없이 쓸 수 있는 factory (CLI/수집 worker 용) */
export function createStorageProvider(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const driver = env.STORAGE_DRIVER ?? "mock";
  return driver === "r2"
    ? new R2StorageProvider({
        publicBaseUrl: env.R2_PUBLIC_BASE_URL || undefined,
        accountId: env.R2_ACCOUNT_ID || undefined,
        accessKeyId: env.R2_ACCESS_KEY_ID || undefined,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY || undefined,
        bucket: env.R2_BUCKET || undefined,
      })
    : new MockStorageProvider();
}

export function getSharedStorageProvider(): StorageProvider {
  provider ??= createStorageProvider();
  return provider;
}
