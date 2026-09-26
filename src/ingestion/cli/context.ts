import os from "node:os";
import { createDb, type Database } from "../../db/client";
import { createStorageProvider } from "../../lib/storage/factory";
import { httpRevalidator, type IngestionContext } from "../context";
import { createLogger } from "../logger";
import { createOpsNotifier } from "../notifier";
import { createDbAlertGate, failOpen } from "../ops/alert-gate";

export function requireDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL 이 필요합니다. (.env.example 참고, 구조만 보려면 --dry-run)");
    process.exit(2);
  }
  return createDb(url, 5);
}

export function createCliContext(db: Database): IngestionContext {
  const logger = createLogger();
  return {
    db,
    logger,
    notifier: createOpsNotifier(logger, process.env, failOpen(createDbAlertGate(db))),
    storage: createStorageProvider(),
    revalidator: httpRevalidator(process.env.NEXT_PUBLIC_SITE_URL, process.env.CRON_SECRET),
    now: () => new Date(),
    workerId: `cli:${os.hostname()}:${process.pid}`,
  };
}

export async function closeDb(db: Database) {
  await db.$client.end({ timeout: 5 });
}
