import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  DB_CRON_JOBS,
  DbSchedulerUnavailableError,
  installDbScheduler,
  jobCommand,
  normalizeSiteUrl,
} from "../../src/ingestion/ops/db-scheduler";
import { SCHEDULED_TASKS } from "../../src/ingestion/ops/scheduler";

describe("DB scheduler (pg_cron + pg_net)", () => {
  it("등급컷은 5분, watchdog 은 매시 — watchdog 기대 주기와 일치", () => {
    const gc = DB_CRON_JOBS.find((j) => j.task === "grade-cuts")!;
    expect(gc.schedule).toBe("*/5 * * * *");
    const spec = SCHEDULED_TASKS.find((s) => s.task === "grade-cuts")!;
    expect(spec.cadenceMinutes).toBe(5);
    // stale 기준은 주기의 4배 — 한두 번 늦어도 알리지 않는다
    expect(spec.staleAfterMinutes).toBe(20);
    // pg_net 제한 시간은 endpoint maxDuration(300s)보다 짧고, 다음 실행(5분)보다 짧다
    expect(gc.timeoutMs).toBeLessThan(300_000);
    expect(DB_CRON_JOBS.find((j) => j.task === "watchdog")!.schedule).toBe("17 * * * *");
  });

  it("job SQL 에는 Vault 이름만 — 비밀값·URL 이 들어갈 자리가 없다", () => {
    const sql = jobCommand(DB_CRON_JOBS[0]!);
    expect(sql).toContain("vault.decrypted_secrets where name = 'mogo_site_url'");
    expect(sql).toContain("vault.decrypted_secrets where name = 'mogo_cron_secret'");
    expect(sql).toContain("'/api/cron/grade-cuts'");
    expect(sql).toContain("'Authorization', 'Bearer ' ||");
    expect(sql).toContain("'X-Scheduler', 'pg_cron'");
    expect(sql).toContain("timeout_milliseconds := 290000");
    expect(sql).not.toMatch(/https?:\/\//);
    expect(() => jobCommand({ ...DB_CRON_JOBS[0]!, task: "x'; drop" as never })).toThrow();
  });

  it("사이트 URL 은 인증정보·경로 없는 https origin 만", () => {
    expect(normalizeSiteUrl("https://mogo-storage.vercel.app")).toBe(
      "https://mogo-storage.vercel.app",
    );
    expect(normalizeSiteUrl("https://mogo-storage.vercel.app/")).toBe(
      "https://mogo-storage.vercel.app",
    );
    for (const bad of [
      "http://mogo.example",
      "https://u:p@mogo.example",
      "https://mogo.example/api",
      "https://mogo.example/?x=1",
      "nope",
    ])
      expect(() => normalizeSiteUrl(bad)).toThrow();
  });

  it("pg_cron · pg_net · Vault 중 하나라도 없으면 아무것도 바꾸지 않고 실패", async () => {
    const statements: string[] = [];
    const stub = ((strings: TemplateStringsArray) => {
      statements.push(strings.join("?"));
      // pg_available_extensions: pg_cron 만 있음
      return Promise.resolve([{ name: "pg_cron" }]);
    }) as unknown as postgres.Sql;
    (stub as unknown as { begin: () => never }).begin = () => {
      throw new Error("트랜잭션을 시작하면 안 된다");
    };
    await expect(
      installDbScheduler(stub, {
        siteUrl: "https://mogo.example",
        cronSecret: "0123456789abcdef0123",
      }),
    ).rejects.toThrow(DbSchedulerUnavailableError);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("pg_available_extensions");
  });

  it("짧은 CRON_SECRET · 잘못된 URL 은 DB 에 접속하기 전에 거부", async () => {
    const stub = (() => {
      throw new Error("DB 에 접속하면 안 된다");
    }) as unknown as postgres.Sql;
    await expect(
      installDbScheduler(stub, { siteUrl: "https://mogo.example", cronSecret: "short" }),
    ).rejects.toThrow(/16자/);
    await expect(
      installDbScheduler(stub, { siteUrl: "http://mogo.example", cronSecret: "0123456789abcdef" }),
    ).rejects.toThrow(/https/);
  });
});
