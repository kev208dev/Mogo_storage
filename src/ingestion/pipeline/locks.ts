import type { Database } from "../../db/client";

/**
 * PostgreSQL advisory lock. 여러 인스턴스/cron 이 동시에 실행돼도 같은 key 작업은 하나만 진행한다.
 * 연결 풀에서 같은 연결을 유지해야 하므로 reserve() 한 연결에서 lock/unlock 한다.
 * lock 을 얻지 못하면 fn 을 실행하지 않고 { acquired: false } 를 돌려준다.
 */
export async function withAdvisoryLock<T>(
  db: Database,
  key: string,
  fn: () => Promise<T>,
  onStage?: (
    stage: "advisory_reserve" | "advisory_lock" | "advisory_unlock" | "advisory_release",
  ) => void,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  onStage?.("advisory_reserve");
  const conn = await db.$client.reserve();
  let operationCompleted = false;
  let unlockCompleted = false;
  try {
    onStage?.("advisory_lock");
    const [row] = await conn<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${key}, 0)) as locked`;
    if (!row?.locked) {
      operationCompleted = true;
      unlockCompleted = true;
      return { acquired: false };
    }
    try {
      const value = await fn();
      operationCompleted = true;
      return { acquired: true, value };
    } finally {
      if (operationCompleted) onStage?.("advisory_unlock");
      await conn`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
      unlockCompleted = true;
    }
  } finally {
    if (operationCompleted && unlockCompleted) onStage?.("advisory_release");
    conn.release();
  }
}
