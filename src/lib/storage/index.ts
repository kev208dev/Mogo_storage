import "server-only";
import { getSharedStorageProvider } from "./factory";
import type { StorageProvider } from "./types";

export function getStorageProvider(): StorageProvider {
  return getSharedStorageProvider();
}

export type { StorageProvider, StorageFile } from "./types";
