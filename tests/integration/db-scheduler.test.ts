import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DB_CRON_JOBS,
  dbSchedulerStatus,
  installDbScheduler,
  uninstallDbScheduler,
  VAULT_SITE_URL,
} from "@/ingestion/ops/db-scheduler";

/**
 * 실제 pg_cron · pg_net · supabase_vault 가 있는 PostgreSQL 에서만 실행한다 (Supabase 와 같은 구성).
 *   DATABASE_URL_SCHEDULER_TEST=postgres://postgres:...@localhost:5433/postgres
 * (shared_preload_libraries = 'supabase_vault,pg_cron,pg_net', cron.database_name 이 같은 DB)
 */
const URL_ = process.env.DATABASE_URL_SCHEDULER_TEST;
const SECRET = "test-cron-secret-0123456789abcdef";

describe.skipIf(!URL_)("DB scheduler (pg_cron + pg_net + Vault)", () => {
  let sql: postgres.Sql;
  let server: Server;
  let port = 0;
  const hits: Array<{ path: string; headers: IncomingHttpHeaders; at: number }> = [];

  beforeAll(async () => {
    sql = postgres(URL_!, { max: 1, prepare: false, onnotice: () => {} });
    server = createServer((req, res) => {
      hits.push({ path: req.url ?? "", headers: req.headers, at: Date.now() });
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await uninstallDbScheduler(sql).catch(() => {});
    await sql.end({ timeout: 5 });
    server.close();
  });
  beforeEach(() => {
    hits.length = 0;
  });

  /** 테스트에서만: Vault 의 사이트 URL 을 로컬 http 서버로 바꾼다 (운영 설치는 https 만 허용) */
  const pointToLocal = async () => {
    const [row] = await sql<{ id: string }[]>`
      select id from vault.secrets where name = ${VAULT_SITE_URL}`;
    await sql`select vault.update_secret(${row!.id}::uuid, ${`http://127.0.0.1:${port}`})`;
  };

  const waitFor = async (cond: () => boolean, ms: number) => {
    const until = Date.now() + ms;
    while (!cond() && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  };

  it("설치: job 2개 · Vault 비밀값 · job SQL 에 비밀값 없음 · 다시 설치해도 job 이 늘지 않음", async () => {
    await installDbScheduler(sql, { siteUrl: "https://mogo.example.com", cronSecret: SECRET });
    await installDbScheduler(sql, { siteUrl: "https://mogo.example.com", cronSecret: SECRET });
    const jobs = await sql<{ jobname: string; schedule: string; command: string }[]>`
      select jobname, schedule, command from cron.job where jobname like 'mogo-%' order by jobname`;
    expect(jobs.map((j) => [j.jobname, j.schedule])).toEqual([
      ["mogo-grade-cuts", "*/5 * * * *"],
      ["mogo-scheduler-watchdog", "17 * * * *"],
    ]);
    for (const j of jobs) {
      expect(j.command).not.toContain(SECRET);
      expect(j.command).not.toContain("mogo.example.com");
    }
    const status = await dbSchedulerStatus(sql);
    expect(status.vaultSecrets).toEqual(["mogo_cron_secret", "mogo_site_url"]);
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });

  it("job SQL 을 실행하면 pg_net 이 Bearer CRON_SECRET · X-Scheduler: pg_cron 으로 endpoint 를 부른다", async () => {
    await installDbScheduler(sql, { siteUrl: "https://mogo.example.com", cronSecret: SECRET });
    await pointToLocal();
    const [job] = await sql<{ command: string }[]>`
      select command from cron.job where jobname = 'mogo-grade-cuts'`;
    await sql.unsafe(job!.command);
    await waitFor(() => hits.length > 0, 15_000);
    expect(hits[0]).toMatchObject({ path: "/api/cron/grade-cuts" });
    expect(hits[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(hits[0]!.headers["x-scheduler"]).toBe("pg_cron");
  });

  it("pg_cron 이 스스로 반복 실행한다 (주기를 2초로 줄여 확인)", async () => {
    await installDbScheduler(sql, { siteUrl: "https://mogo.example.com", cronSecret: SECRET });
    await pointToLocal();
    await sql`select cron.alter_job(jobid, schedule := '2 seconds')
              from cron.job where jobname = 'mogo-grade-cuts'`;
    await waitFor(() => hits.filter((h) => h.path === "/api/cron/grade-cuts").length >= 3, 30_000);
    const runs = hits.filter((h) => h.path === "/api/cron/grade-cuts");
    expect(runs.length).toBeGreaterThanOrEqual(3);
    const status = await dbSchedulerStatus(sql);
    expect(status.runs.filter((r) => r.job === "mogo-grade-cuts").length).toBeGreaterThanOrEqual(3);
    expect(status.runs.every((r) => r.status === "succeeded" || r.status === "running")).toBe(true);
    // 다시 설치하면 운영 주기(*/5)로 돌아간다
    await installDbScheduler(sql, { siteUrl: "https://mogo.example.com", cronSecret: SECRET });
    const [job] = await sql<{ schedule: string }[]>`
      select schedule from cron.job where jobname = 'mogo-grade-cuts'`;
    expect(job!.schedule).toBe(DB_CRON_JOBS[0]!.schedule);
  }, 45_000);

  it("제거: job 과 Vault 항목이 모두 사라진다", async () => {
    await installDbScheduler(sql, { siteUrl: "https://mogo.example.com", cronSecret: SECRET });
    const { removed } = await uninstallDbScheduler(sql);
    expect(removed.sort()).toEqual(["mogo-grade-cuts", "mogo-scheduler-watchdog"]);
    const status = await dbSchedulerStatus(sql);
    expect(status.jobs).toEqual([]);
    expect(status.vaultSecrets).toEqual([]);
  });
});
