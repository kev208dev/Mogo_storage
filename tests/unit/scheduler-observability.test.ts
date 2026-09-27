import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/ingestion/logger";
import {
  alertKey,
  formatNotification,
  LogOpsNotifier,
  WebhookOpsNotifier,
  type OpsNotification,
} from "@/ingestion/notifier";
import { createMemoryAlertGate, failOpen, type AlertGate } from "@/ingestion/ops/alert-gate";
import {
  evaluateSchedulerHealth,
  safeDetail,
  SCHEDULED_TASKS,
  type HeartbeatRow,
} from "@/ingestion/ops/scheduler";
import { checkProductionEnv } from "@/lib/server/env";

const NOW = new Date("2026-09-26T03:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const row = (task: string, patch: Partial<HeartbeatRow> = {}): HeartbeatRow => ({
  task,
  lastStartedAt: minutesAgo(3),
  lastFinishedAt: minutesAgo(2),
  lastSuccessAt: minutesAgo(2),
  lastStatus: "ok",
  lastDetail: null,
  lastDurationMs: 1200,
  consecutiveFailures: 0,
  runCount: 10,
  ...patch,
});
const ENV_ON = { GRADE_CUT_INGESTION_ENABLED: "true", INGESTION_ENABLED: "true" };

describe("scheduler heartbeat 판정", () => {
  const byTask = (rows: HeartbeatRow[], env: Record<string, string> = ENV_ON) =>
    Object.fromEntries(evaluateSchedulerHealth(rows, NOW, env).map((t) => [t.task, t]));

  it("정상 · stale · 연속 실패 · 기록 없음 · 꺼짐", () => {
    const t = byTask([
      row("grade-cuts"),
      row("scheduled", { lastStartedAt: minutesAgo(200), lastFinishedAt: minutesAgo(199) }),
      row("watchdog", { consecutiveFailures: 5, lastStatus: "failed" }),
    ]);
    expect(t["grade-cuts"]!.state).toBe("ok");
    expect(t["grade-cuts"]!.minutesSinceSeen).toBe(2);
    expect(t["scheduled"]!.state).toBe("stale");
    expect(t["watchdog"]!.state).toBe("failing");

    const empty = byTask([]);
    expect(empty["grade-cuts"]!.state).toBe("never_run");
    const off = byTask([], {});
    expect(off["grade-cuts"]!.state).toBe("disabled");
    expect(off["scheduled"]!.state).toBe("disabled");
  });

  it("등급컷은 pg_cron 5분 주기 — 4회(20분)까지 놓쳐도 정상, 그 이후 stale", () => {
    const t = byTask([row("grade-cuts", { lastStartedAt: minutesAgo(20), lastFinishedAt: null })]);
    expect(t["grade-cuts"]!.state).toBe("ok");
    const late = byTask([
      row("grade-cuts", { lastStartedAt: minutesAgo(21), lastFinishedAt: null }),
    ]);
    expect(late["grade-cuts"]!.state).toBe("stale");
  });

  it("stale 은 연속 실패보다 우선하고, 실행 중(running)도 실행으로 본다", () => {
    const t = byTask([
      row("grade-cuts", {
        lastStartedAt: minutesAgo(1),
        lastFinishedAt: minutesAgo(90),
        lastStatus: "running",
      }),
    ]);
    expect(t["grade-cuts"]!.state).toBe("ok");
  });

  it("env 로 stale 기준 조정 (주기보다 짧은 값은 무시)", () => {
    const rows = [row("grade-cuts", { lastStartedAt: minutesAgo(50), lastFinishedAt: null })];
    expect(
      byTask(rows, { ...ENV_ON, SCHEDULER_STALE_MINUTES_GRADE_CUTS: "60" })["grade-cuts"]!.state,
    ).toBe("ok");
    expect(
      byTask(rows, { ...ENV_ON, SCHEDULER_STALE_MINUTES_GRADE_CUTS: "1" })["grade-cuts"]!
        .staleAfterMinutes,
    ).toBe(SCHEDULED_TASKS[0]!.staleAfterMinutes);
  });

  it("상태 코드에는 짧은 식별자만 저장 (오류 메시지·URL 차단)", () => {
    expect(safeDetail("advisory_lock")).toBe("advisory_lock");
    expect(safeDetail("postgres://user:pw@host/db")).toBe("other");
    expect(safeDetail("connect ECONNREFUSED 10.0.0.1")).toBe("other");
    expect(safeDetail(null)).toBeNull();
  });
});

describe("운영 알림 dedupe/cooldown", () => {
  const stale: OpsNotification = {
    kind: "scheduler_stale",
    task: "grade-cuts",
    label: "등급컷 watch",
    minutesSinceSeen: 70,
  };

  it("같은 cron 의 stale 과 연속 실패는 한 key 로 묶이고, 게시·복구 알림은 dedupe 하지 않는다", () => {
    expect(alertKey(stale)).toBe("scheduler:grade-cuts");
    expect(
      alertKey({
        kind: "scheduler_failing",
        task: "grade-cuts",
        label: "x",
        consecutiveFailures: 3,
      }),
    ).toBe("scheduler:grade-cuts");
    expect(alertKey({ kind: "scheduler_recovered", task: "grade-cuts", label: "x" })).toBeNull();
    expect(alertKey({ kind: "artifacts_published", examLabel: "x", items: [] })).toBeNull();
    expect(alertKey({ kind: "job_dead", jobType: "verify", jobId: "1", message: "m" })).toBe(
      alertKey({ kind: "job_dead", jobType: "verify", jobId: "2", message: "m" }),
    );
    expect(formatNotification(stale)).toContain("70분째 실행 없음");
  });

  it("cooldown 동안 한 번만 보내고, 이후 발송 때 생략 횟수를 알린다", async () => {
    let clock = NOW;
    const fetchImpl = vi.fn(async () => new Response("", { status: 204 }));
    const gate = createMemoryAlertGate(60 * 60_000);
    const notifier = new WebhookOpsNotifier(
      "https://hook.example/x",
      new LogOpsNotifier(createLogger(() => {})),
      fetchImpl as unknown as typeof fetch,
      5000,
      gate,
      () => clock,
    );
    await notifier.notify(stale);
    await notifier.notify(stale);
    await notifier.notify({ ...stale, minutesSinceSeen: 80 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 다른 문제(다른 task)는 따로 보낸다
    await notifier.notify({ ...stale, task: "scheduled" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clock = new Date(NOW.getTime() + 61 * 60_000);
    await notifier.notify(stale);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const body = JSON.parse(
      (fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.text).toContain("2회 생략");
  });

  it("gate 가 실패하면 알림을 막지 않는다 (fail open)", async () => {
    const broken: AlertGate = {
      claim: async () => {
        throw new Error("relation does not exist");
      },
      clear: async () => {
        throw new Error("x");
      },
    };
    const safe = failOpen(broken);
    await expect(safe.claim({ key: "k", kind: "k", message: "m", now: NOW })).resolves.toEqual({
      send: true,
      suppressedSinceLast: 0,
    });
    await expect(safe.clear("k")).resolves.toBe(false);
  });
});

describe("production env 검증 강화", () => {
  const ok = {
    NEXT_PUBLIC_SITE_URL: "https://mogo.example.com",
    DATABASE_URL: "postgres://x",
    ADMIN_EMAIL_ALLOWLIST: "ops@example.com",
    ADMIN_ACCESS_TOKEN: "t".repeat(24),
    ADMIN_SESSION_SECRET: "s".repeat(32),
    CRON_SECRET: "c".repeat(32),
    INGESTION_ENABLED: "true",
    GRADE_CUT_INGESTION_ENABLED: "true",
  };
  const errors = (patch: Record<string, string | undefined>) =>
    checkProductionEnv({ ...ok, ...patch }).errors.join("\n");

  it("정상 설정은 오류 없음", () => {
    expect(checkProductionEnv(ok).errors).toEqual([]);
  });

  it("사이트 URL 경로·계정정보 · 관리자 설정 일부 · 약한 secret · 샘플 색인 · 등급컷 cron secret", () => {
    expect(errors({ NEXT_PUBLIC_SITE_URL: "https://mogo.example.com/app" })).toMatch(/origin/);
    expect(errors({ NEXT_PUBLIC_SITE_URL: "https://u:p@mogo.example.com" })).toMatch(/계정/);
    expect(errors({ ADMIN_SESSION_SECRET: undefined })).toMatch(/일부만/);
    expect(errors({ ADMIN_ACCESS_TOKEN: "short" })).toMatch(/ADMIN_ACCESS_TOKEN/);
    expect(errors({ ADMIN_SESSION_SECRET: "short-secret-0123456789" })).toMatch(
      /ADMIN_SESSION_SECRET/,
    );
    expect(errors({ ADMIN_EMAIL_ALLOWLIST: "not-an-email" })).toMatch(/이메일/);
    expect(errors({ ALLOW_SAMPLE_INDEXING: "1" })).toMatch(/샘플/);
    expect(errors({ INGESTION_ENABLED: "false", CRON_SECRET: "short" })).toMatch(
      /GRADE_CUT_INGESTION_ENABLED/,
    );
    expect(
      errors({ STORAGE_DRIVER: "r2", R2_ACCOUNT_ID: "a", R2_PUBLIC_BASE_URL: "https://x" }),
    ).toMatch(/일부만/);
    expect(errors({ STORAGE_DRIVER: "r2", R2_PUBLIC_BASE_URL: "http://files.example" })).toMatch(
      /R2_PUBLIC_BASE_URL/,
    );
  });

  it("오류 메시지에 secret 값이 들어가지 않는다", () => {
    const secret = "super-secret-value-0123456789abcdef";
    const out = checkProductionEnv({
      ...ok,
      ADMIN_ACCESS_TOKEN: secret,
      ADMIN_SESSION_SECRET: "x",
      CRON_SECRET: secret.slice(0, 8),
      DATABASE_URL: `postgres://u:${secret}@h/db`,
    });
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).not.toContain(secret.slice(0, 8));
  });
});
