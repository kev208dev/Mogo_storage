import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  DB_CRON_JOBS,
  DbSchedulerUnavailableError,
  GRADE_CUT_FAST_WINDOW_DAYS,
  installDbScheduler,
  jobCommand,
  normalizeSiteUrl,
} from "../../src/ingestion/ops/db-scheduler";
import { SCHEDULED_TASKS } from "../../src/ingestion/ops/scheduler";

describe("DB scheduler (pg_cron + pg_net)", () => {
  it("등급컷은 5분 tick, 실제 HTTP 는 시험 종료 후 활성 구간만 — watchdog 기대 주기와 일치", () => {
    const gc = DB_CRON_JOBS.find((j) => j.task === "grade-cuts")!;
    expect(gc.schedule).toBe("*/5 * * * *");
    expect(GRADE_CUT_FAST_WINDOW_DAYS).toBe(7);
    const spec = SCHEDULED_TASKS.find((s) => s.task === "grade-cuts")!;
    expect(spec.cadenceMinutes).toBe(5);
    // 활성 구간 밖 tick 도 DB heartbeat 를 남기므로 watchdog 의 5분 기대 주기는 그대로 유지한다.
    expect(spec.staleAfterMinutes).toBe(20);
    // pg_net 제한 시간은 endpoint maxDuration(300s)보다 짧고, 다음 실행(5분)보다 짧다
    expect(gc.timeoutMs).toBeLessThan(300_000);
    expect(DB_CRON_JOBS.find((j) => j.task === "watchdog")!.schedule).toBe("17 * * * *");
  });

  it("grade-cut job SQL 은 활성 시험이 있을 때만 HTTP 를 보내고 그 밖에는 skipped heartbeat 만 남긴다", () => {
    const sql = jobCommand(DB_CRON_JOBS[0]!);
    expect(sql).toContain("vault.decrypted_secrets where name = 'mogo_site_url'");
    expect(sql).toContain("vault.decrypted_secrets where name = 'mogo_cron_secret'");
    expect(sql).toContain("'/api/cron/grade-cuts'");
    expect(sql).toContain("'Authorization', 'Bearer ' ||");
    expect(sql).toContain("'X-Scheduler', 'pg_cron'");
    expect(sql).toContain("timeout_milliseconds := 290000");
    expect(sql).toContain("from public.exams");
    expect(sql).toContain("exam_type::text = 'csat'");
    expect(sql).toContain("exam_type::text = 'kice_mock'");
    expect(sql).toContain("at time zone 'Asia/Seoul'");
    expect(sql).toContain(`interval '${GRADE_CUT_FAST_WINDOW_DAYS} days'`);
    expect(sql).toContain("insert into public.scheduler_heartbeats");
    expect(sql).toContain("'pg_cron:no_active_window'");
    expect(sql).toContain("from active_window");
    expect(sql).not.toMatch(/https?:\/\//);
    expect(() => jobCommand({ ...DB_CRON_JOBS[0]!, task: "x'; drop" as never })).toThrow();

    const watchdogSql = jobCommand(DB_CRON_JOBS.find((j) => j.task === "watchdog")!);
    expect(watchdogSql).toContain("'/api/cron/watchdog'");
    expect(watchdogSql).not.toContain("public.exams");
    expect(watchdogSql).not.toContain("scheduler_heartbeats");
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
