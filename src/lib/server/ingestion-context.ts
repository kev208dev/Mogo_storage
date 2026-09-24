import "server-only";
import os from "node:os";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import type { IngestionContext } from "@/ingestion/context";
import { createLogger } from "@/ingestion/logger";
import { LogOpsNotifier } from "@/ingestion/notifier";
import { getSharedStorageProvider } from "@/lib/storage/factory";

/** Next 런타임(cron route, admin action)에서 쓰는 수집 context. 게시 즉시 revalidatePath 로 페이지 갱신 */
export function createAppIngestionContext(): IngestionContext | null {
  const db = getDb();
  if (!db) return null;
  const logger = createLogger();
  return {
    db,
    logger,
    notifier: new LogOpsNotifier(logger),
    storage: getSharedStorageProvider(),
    revalidator: {
      async revalidatePaths(paths) {
        for (const path of new Set(paths)) revalidatePath(path);
        revalidatePath("/sitemap.xml");
      },
    },
    now: () => new Date(),
    workerId: `app:${os.hostname()}:${process.pid}`,
  };
}
