import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { createLogger } from "@/ingestion/logger";
import { LogOpsNotifier, WebhookOpsNotifier } from "@/ingestion/notifier";
import { createDbAlertGate } from "@/ingestion/ops/alert-gate";
import { loadHeartbeat, recordTaskFinish, recordTaskStart } from "@/ingestion/ops/scheduler";
import { runSchedulerWatchdog } from "@/ingestion/ops/watchdog";
import { setupDb, TEST_DB_URL } from "./helpers";

const NOW = new Date("2026-09-26T03:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe.skipIf(!TEST_DB_URL)("scheduler heartbeat · watchdog · 알림 dedupe (PostgreSQL)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await setupDb();
  });
  afterAll(async () => {
    await db?.$client.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await db.delete(s.schedulerHeartbeats);
    await db.delete(s.opsAlertStates);
  });

  it("실행 시작/종료를 기록하고 연속 실패를 센다", async () => {
    await recordTaskStart(db, "grade-cuts", at(0));
    expect(await loadHeartbeat(db, "grade-cuts")).toMatchObject({
      lastStatus: "running",
      runCount: 1,
    });
    await recordTaskFinish(db, "grade-cuts", { status: "ok", startedAt: at(0) }, at(1));
    for (const m of [5, 10]) {
      await recordTaskStart(db, "grade-cuts", at(m));
      await recordTaskFinish(
        db,
        "grade-cuts",
        { status: "failed", detail: "advisory_lock", startedAt: at(m) },
        at(m + 1),
      );
    }
    let hb = await loadHeartbeat(db, "grade-cuts");
    expect(hb).toMatchObject({
      runCount: 3,
      consecutiveFailures: 2,
      lastStatus: "failed",
      lastDetail: "advisory_lock",
      lastDurationMs: 60_000,
    });
    expect(hb!.lastSuccessAt).toEqual(at(1));

    await recordTaskFinish(
      db,
      "grade-cuts",
      { status: "skipped", detail: "locked", startedAt: at(15) },
      at(15),
    );
    expect((await loadHeartbeat(db, "grade-cuts"))!.consecutiveFailures).toBe(2);
    await recordTaskFinish(db, "grade-cuts", { status: "ok", startedAt: at(20) }, at(20));
    hb = await loadHeartbeat(db, "grade-cuts");
    expect(hb).toMatchObject({ consecutiveFailures: 0, lastStatus: "ok" });
    expect(hb!.lastSuccessAt).toEqual(at(20));
  });

  it("DB gate: cooldown 동안 한 번만 보내고, 생략 횟수를 다음 발송에 넘긴다", async () => {
    const gate = createDbAlertGate(db, 60 * 60_000);
    const claim = (m: number) =>
      gate.claim({ key: "k", kind: "job_dead", message: "x", now: at(m) });
    expect(await claim(0)).toEqual({ send: true, suppressedSinceLast: 0 });
    expect((await claim(5)).send).toBe(false);
    expect((await claim(10)).send).toBe(false);
    expect(await claim(61)).toEqual({ send: true, suppressedSinceLast: 2 });
    // 동시에 처음 보는 key 를 요청해도 한 번만 보낸다
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        gate.claim({ key: "race", kind: "job_dead", message: "x", now: at(0) }),
      ),
    );
    expect(results.filter((r) => r.send)).toHaveLength(1);
    expect(await gate.clear("k")).toBe(true);
    expect(await gate.clear("k")).toBe(false);
  });

  it("watchdog: stale 알림은 한 번만, 복구되면 복구 알림 한 번", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 204 }));
    let clock = at(0);
    const gate = createDbAlertGate(db, 6 * 60 * 60_000);
    const notifier = new WebhookOpsNotifier(
      "https://hook.example/x",
      new LogOpsNotifier(createLogger(() => {})),
      fetchImpl as unknown as typeof fetch,
      5000,
      gate,
      () => clock,
    );
    const env = { GRADE_CUT_INGESTION_ENABLED: "true" };
    const run = () => runSchedulerWatchdog({ db, notifier, gate, now: clock, env });

    // 등급컷 cron 이 켜져 있는데 기록이 없다 → 알림
    let result = await run();
    expect(result.alerted).toEqual(["grade-cuts"]);
    expect(result.tasks.find((t) => t.task === "scheduled")!.state).toBe("disabled");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // 한 시간 뒤에도 여전히 문제 → 알림은 cooldown 으로 생략
    clock = at(60);
    result = await run();
    expect(result.alerted).toEqual(["grade-cuts"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // cron 이 다시 돈다 → 복구 알림 1회, 그 뒤로는 없음
    await recordTaskStart(db, "grade-cuts", at(62));
    await recordTaskFinish(db, "grade-cuts", { status: "ok", startedAt: at(62) }, at(63));
    clock = at(65);
    result = await run();
    expect(result.recovered).toEqual(["grade-cuts"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const recovered = JSON.parse(
      (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(recovered.event).toBe("scheduler_recovered");
    result = await run();
    expect(result.recovered).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("cron route: 모든 실행을 heartbeat 로 남기고 watchdog 은 상태만 돌려준다", async () => {
    const prior = { ...process.env };
    process.env.CRON_SECRET = "route-test-secret-0123456789";
    process.env.DATABASE_URL = TEST_DB_URL;
    delete process.env.GRADE_CUT_INGESTION_ENABLED;
    delete process.env.INGESTION_ENABLED;
    delete process.env.OPS_WEBHOOK_URL;
    try {
      const { GET } = await import("@/app/api/cron/[task]/route");
      const call = (
        task: string,
        token = process.env.CRON_SECRET,
        extra: Record<string, string> = {},
      ) =>
        GET(
          new Request(`https://mogo.example/api/cron/${task}`, {
            headers: { authorization: `Bearer ${token}`, ...extra },
          }),
          { params: Promise.resolve({ task }) },
        );

      const denied = await call("grade-cuts", "wrong-secret-0123456789abcd");
      expect(denied.status).toBe(401);
      expect(await loadHeartbeat(db, "grade-cuts")).toBeNull();

      const skipped = await call("grade-cuts");
      expect(skipped.status).toBe(200);
      expect(await skipped.json()).toEqual({ skipped: "GRADE_CUT_INGESTION_ENABLED is not true" });
      // 누가 불렀는지 detail 에 남는다: 헤더 없으면 manual
      expect(await loadHeartbeat(db, "grade-cuts")).toMatchObject({
        lastStatus: "skipped",
        lastDetail: "manual:disabled",
        runCount: 1,
      });
      await call("grade-cuts", undefined, { "x-scheduler": "pg_cron" });
      expect(await loadHeartbeat(db, "grade-cuts")).toMatchObject({
        lastDetail: "pg_cron:disabled",
        runCount: 2,
      });
      await call("grade-cuts", undefined, { "user-agent": "vercel-cron/1.0" });
      expect((await loadHeartbeat(db, "grade-cuts"))!.lastDetail).toBe("vercel_cron:disabled");
      // 헤더 값은 짧은 식별자만 — 이상한 값은 manual 로 취급
      await call("grade-cuts", undefined, { "x-scheduler": "https://evil.example/?x=1" });
      expect((await loadHeartbeat(db, "grade-cuts"))!.lastDetail).toBe("manual:disabled");

      const watchdog = await call("watchdog");
      expect(watchdog.status).toBe(200);
      expect(watchdog.headers.get("cache-control")).toContain("no-store");
      const body = await watchdog.json();
      expect(body.ok).toBe(true);
      expect(body.alerted).toEqual([]);
      expect(body.tasks.map((t: { task: string; state: string }) => [t.task, t.state])).toEqual([
        ["grade-cuts", "disabled"],
        ["scheduled", "disabled"],
      ]);
      // 응답에는 상태 코드만 — 비밀값이나 URL 이 없다
      expect(JSON.stringify(body)).not.toContain("route-test-secret");
      expect(JSON.stringify(body)).not.toContain("postgres");
      const [hb] = await db
        .select()
        .from(s.schedulerHeartbeats)
        .where(eq(s.schedulerHeartbeats.task, "watchdog"));
      expect(hb).toMatchObject({ lastStatus: "ok", lastDetail: "manual:healthy" });
      // 주기 확인용 정보 (실행 횟수 · 마지막 시작)
      const gc = body.tasks.find((t: { task: string }) => t.task === "grade-cuts");
      expect(gc).toMatchObject({ runCount: 4, lastStatus: "skipped" });
      expect(typeof gc.lastStartedAt).toBe("string");
    } finally {
      process.env = prior;
    }
  });
});
