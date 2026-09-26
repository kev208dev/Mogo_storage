import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { opsAlertStates } from "@/db/schema";

/**
 * 운영 알림 dedupe/cooldown.
 * 같은 key 의 알림은 cooldown 동안 한 번만 보낸다. 보내지 않은 횟수는 다음 발송 때 함께 알린다.
 */
export interface AlertDecision {
  send: boolean;
  /** 직전 발송 이후 억제된 횟수 (send=true 일 때 알림 본문에 덧붙인다) */
  suppressedSinceLast: number;
}

export interface AlertGate {
  claim(input: { key: string; kind: string; message: string; now: Date }): Promise<AlertDecision>;
  /** 복구 시 상태 제거. 이전에 보낸 알림이 있었으면 true */
  clear(key: string): Promise<boolean>;
}

export const DEFAULT_ALERT_COOLDOWN_MINUTES = 6 * 60;

export function alertCooldownMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.OPS_ALERT_COOLDOWN_MINUTES);
  return (Number.isFinite(n) && n >= 1 ? n : DEFAULT_ALERT_COOLDOWN_MINUTES) * 60_000;
}

/** PostgreSQL 기반 gate. 동시에 여러 인스턴스가 보내도 row lock 으로 한 번만 발송된다 */
export function createDbAlertGate(db: Database, cooldownMs = alertCooldownMs()): AlertGate {
  return {
    async claim({ key, kind, message, now }) {
      const trimmed = message.slice(0, 500);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(opsAlertStates)
          .where(eq(opsAlertStates.key, key))
          .for("update");
        if (!row) {
          // 처음 보는 key: 동시에 두 요청이 와도 insert 에 성공한 쪽만 보낸다
          const inserted = await tx
            .insert(opsAlertStates)
            .values({ key, kind, lastSentAt: now, lastMessage: trimmed, updatedAt: now })
            .onConflictDoNothing()
            .returning({ key: opsAlertStates.key });
          return { send: inserted.length > 0, suppressedSinceLast: 0 };
        }
        if (now.getTime() - row.lastSentAt.getTime() >= cooldownMs) {
          await tx
            .update(opsAlertStates)
            .set({
              kind,
              lastSentAt: now,
              suppressedCount: 0,
              lastMessage: trimmed,
              updatedAt: now,
            })
            .where(eq(opsAlertStates.key, key));
          return { send: true, suppressedSinceLast: row.suppressedCount };
        }
        await tx
          .update(opsAlertStates)
          .set({ suppressedCount: row.suppressedCount + 1, updatedAt: now })
          .where(eq(opsAlertStates.key, key));
        return { send: false, suppressedSinceLast: row.suppressedCount + 1 };
      });
    },
    async clear(key) {
      const rows = await db
        .delete(opsAlertStates)
        .where(eq(opsAlertStates.key, key))
        .returning({ key: opsAlertStates.key });
      return rows.length > 0;
    },
  };
}

/** 메모리 gate (테스트 · DB 없는 CLI) */
export function createMemoryAlertGate(cooldownMs = alertCooldownMs()): AlertGate {
  const state = new Map<string, { lastSentAt: number; suppressed: number }>();
  return {
    async claim({ key, now }) {
      const row = state.get(key);
      if (!row || now.getTime() - row.lastSentAt >= cooldownMs) {
        state.set(key, { lastSentAt: now.getTime(), suppressed: 0 });
        return { send: true, suppressedSinceLast: row?.suppressed ?? 0 };
      }
      row.suppressed += 1;
      return { send: false, suppressedSinceLast: row.suppressed };
    },
    async clear(key) {
      return state.delete(key);
    },
  };
}

/**
 * gate 가 DB 오류(예: migration 미적용)로 실패하면 알림을 막지 않고 그대로 보낸다 (fail open).
 * 알림 누락보다 중복이 낫다.
 */
export function failOpen(gate: AlertGate): AlertGate {
  return {
    async claim(input) {
      try {
        return await gate.claim(input);
      } catch {
        console.warn(JSON.stringify({ event: "ops.alert_gate_unavailable", kind: input.kind }));
        return { send: true, suppressedSinceLast: 0 };
      }
    },
    async clear(key) {
      try {
        return await gate.clear(key);
      } catch {
        return false;
      }
    },
  };
}
