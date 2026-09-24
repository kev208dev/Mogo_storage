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
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const conn = await db.$client.reserve();
  try {
    const [row] = await conn<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${key}, 0)) as locked`;
    if (!row?.locked) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await conn`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
    }
  } finally {
    conn.release();
  }
}
