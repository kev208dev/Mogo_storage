import "server-only";
import { MockStorageProvider } from "./mock-storage";
import { R2StorageProvider } from "./r2-storage";
import type { StorageProvider } from "./types";

let provider: StorageProvider | undefined;

export function getStorageProvider(): StorageProvider {
  if (provider) return provider;
  const driver = process.env.STORAGE_DRIVER ?? "mock";
  provider =
    driver === "r2"
      ? new R2StorageProvider({
          publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || undefined,
          accountId: process.env.R2_ACCOUNT_ID || undefined,
          accessKeyId: process.env.R2_ACCESS_KEY_ID || undefined,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || undefined,
          bucket: process.env.R2_BUCKET || undefined,
        })
      : new MockStorageProvider();
  return provider;
}

export type { StorageProvider, StorageFile } from "./types";
