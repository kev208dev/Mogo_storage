import type postgres from "postgres";

/**
 * 운영 DB(Supabase) 안의 pg_cron + pg_net 으로 cron endpoint 를 호출하는 scheduler.
 *
 * 왜: GitHub Actions `schedule` 은 best-effort 라 이 저장소에서 5분·10분·매시 cron 이 모두
 * 2~4시간 간격으로만 실행됐고, Vercel Hobby 는 5분 Cron 배포를 거절한다. pg_cron 은 DB 서버의
 * 실제 cron 이므로 5분 주기가 지켜진다.
 *
 * 등급컷 job 은 5분 tick 자체는 유지하되 시험 종료 후 짧은 활성 구간에만 HTTP 요청을 보낸다.
 * 활성 구간 밖에서는 provider/Vercel 을 호출하지 않고 heartbeat 만 skipped 로 갱신한다.
 *
 * 비밀값:
 *  - CRON_SECRET 과 사이트 URL 은 Supabase Vault 에만 저장한다 (bind parameter 로 넘김, 로그 없음).
 *  - cron job 의 SQL 에는 Vault 이름만 들어가므로 cron.job / cron.job_run_details 에 비밀값이 남지 않는다.
 *
 * 안전성: endpoint 는 PostgreSQL advisory lock 을 쓰므로 겹쳐 호출돼도 한 번만 실행된다 (나머지는 skipped).
 */

export const VAULT_SITE_URL = "mogo_site_url";
export const VAULT_CRON_SECRET = "mogo_cron_secret";
export const GRADE_CUT_FAST_WINDOW_DAYS = 7;

export interface DbCronJob {
  /** cron.job.jobname — 같은 이름으로 다시 등록하면 교체된다 */
  name: string;
  schedule: string;
  task: "grade-cuts" | "watchdog";
  /** pg_net 요청 제한 시간. endpoint maxDuration(300s) 보다 약간 짧게 */
  timeoutMs: number;
}

export const DB_CRON_JOBS: readonly DbCronJob[] = [
  { name: "mogo-grade-cuts", schedule: "*/5 * * * *", task: "grade-cuts", timeoutMs: 290_000 },
  // watchdog 은 GitHub(매시, best-effort)·Vercel(매일)에 더해 DB 에서도 매시 호출한다
  { name: "mogo-scheduler-watchdog", schedule: "17 * * * *", task: "watchdog", timeoutMs: 60_000 },
];

const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

function httpRequestSql(job: DbCronJob, vault: (name: string) => string): string[] {
  return [
    "select net.http_get(",
    `  url := ${vault(VAULT_SITE_URL)} || ${sqlLiteral(`/api/cron/${job.task}`)},`,
    "  headers := jsonb_build_object(",
    `    'Authorization', 'Bearer ' || ${vault(VAULT_CRON_SECRET)},`,
    "    'X-Scheduler', 'pg_cron'",
    "  ),",
    `  timeout_milliseconds := ${Math.trunc(job.timeoutMs)}`,
    ")",
  ];
}

/**
 * 시험 종류별 보수적 종료 시각(KST)부터 7일 동안만 등급컷 endpoint 를 호출한다.
 * 그 밖의 5분 tick 은 scheduler heartbeat 만 skipped 로 갱신하므로 watchdog 은 정상 동작하면서
 * 이미 끝난 시험의 provider 페이지나 Vercel function 을 계속 두드리지 않는다.
 */
function gradeCutWindowCommand(job: DbCronJob, vault: (name: string) => string): string {
  const examEnd = [
    "(exam_date::timestamp + case",
    "  when exam_type::text = 'csat' then interval '18 hours'",
    "  when exam_type::text = 'kice_mock' then interval '17 hours 30 minutes'",
    "  else interval '17 hours'",
    "end) at time zone 'Asia/Seoul'",
  ].join("\n      ");
  const request = httpRequestSql(job, vault);
  return [
    "with active_window as (",
    "  select 1",
    "  from public.exams",
    "  where is_sample = false",
    "    and exam_date is not null",
    `    and now() >= (${examEnd})`,
    `    and now() <= (${examEnd}) + interval '${GRADE_CUT_FAST_WINDOW_DAYS} days'`,
    "  limit 1",
    "),",
    "request as (",
    ...request.map(
      (line, index) => `  ${index === request.length - 1 ? `${line} as request_id` : line}`,
    ),
    "  from active_window",
    "),",
    "heartbeat as (",
    "  insert into public.scheduler_heartbeats (",
    "    task, last_started_at, last_finished_at, last_status, last_detail,",
    "    last_duration_ms, consecutive_failures, run_count, updated_at",
    "  )",
    "  select 'grade-cuts', now(), now(), 'skipped', 'pg_cron:no_active_window', 0, 0, 1, now()",
    "  where not exists (select 1 from active_window)",
    "  on conflict (task) do update set",
    "    last_started_at = excluded.last_started_at,",
    "    last_finished_at = excluded.last_finished_at,",
    "    last_status = excluded.last_status,",
    "    last_detail = excluded.last_detail,",
    "    last_duration_ms = 0,",
    "    consecutive_failures = 0,",
    "    run_count = public.scheduler_heartbeats.run_count + 1,",
    "    updated_at = excluded.updated_at",
    "  returning 1",
    ")",
    "select request_id from request",
    "union all",
    "select null::bigint from heartbeat",
  ].join("\n");
}

/** cron job 이 실행할 SQL. 비밀값 대신 Vault 이름만 포함한다. */
export function jobCommand(job: DbCronJob): string {
  if (!/^[a-z-]+$/.test(job.task)) throw new Error("invalid task");
  const vault = (name: string) =>
    `(select decrypted_secret from vault.decrypted_secrets where name = ${sqlLiteral(name)})`;
  if (job.task === "grade-cuts") return gradeCutWindowCommand(job, vault);
  return httpRequestSql(job, vault).join("\n");
}

/** 사이트 URL: https origin 만 (경로·쿼리·인증정보 없음) */
export function normalizeSiteUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("site URL 형식이 올바르지 않습니다");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("site URL 은 인증정보·쿼리 없는 https 주소여야 합니다");
  if (url.pathname !== "/" && url.pathname !== "")
    throw new Error("site URL 은 origin 만 허용합니다 (경로 없음)");
  return url.origin;
}

export interface ExtensionCheck {
  pgCron: boolean;
  pgNet: boolean;
  vault: boolean;
}

export async function checkExtensions(sql: postgres.Sql): Promise<ExtensionCheck> {
  const rows = await sql<{ name: string }[]>`
    select name from pg_available_extensions where name in ('pg_cron', 'pg_net', 'supabase_vault')`;
  const names = new Set(rows.map((r) => r.name));
  return {
    pgCron: names.has("pg_cron"),
    pgNet: names.has("pg_net"),
    vault: names.has("supabase_vault"),
  };
}

export class DbSchedulerUnavailableError extends Error {
  constructor(missing: string[]) {
    super(
      `이 DB 에서 사용할 수 없는 extension: ${missing.join(", ")} — Supabase(pg_cron·pg_net·Vault)가 필요합니다. 아무것도 변경하지 않았습니다.`,
    );
    this.name = "DbSchedulerUnavailableError";
  }
}

async function upsertVaultSecret(
  sql: postgres.Sql | postgres.TransactionSql,
  name: string,
  value: string,
) {
  const [existing] = await sql<{ id: string }[]>`select id from vault.secrets where name = ${name}`;
  if (existing) await sql`select vault.update_secret(${existing.id}::uuid, ${value})`;
  else await sql`select vault.create_secret(${value}, ${name})`;
}

/**
 * 설치 (idempotent). extension 이 하나라도 없으면 아무것도 바꾸지 않고 실패한다.
 * 같은 이름의 job 은 교체되므로 여러 번 실행해도 job 이 늘어나지 않는다.
 */
export async function installDbScheduler(
  sql: postgres.Sql,
  input: { siteUrl: string; cronSecret: string; jobs?: readonly DbCronJob[] },
): Promise<{ jobs: string[] }> {
  const siteUrl = normalizeSiteUrl(input.siteUrl);
  if (input.cronSecret.length < 16) throw new Error("CRON_SECRET 은 16자 이상이어야 합니다");
  const ext = await checkExtensions(sql);
  const missing = [
    !ext.pgCron && "pg_cron",
    !ext.pgNet && "pg_net",
    !ext.vault && "supabase_vault",
  ].filter((x): x is string => Boolean(x));
  if (missing.length) throw new DbSchedulerUnavailableError(missing);

  const jobs = input.jobs ?? DB_CRON_JOBS;
  await sql.begin(async (tx) => {
    // Supabase 는 Vault 가 이미 켜져 있다 (no-op). 다른 구성에서도 같은 순서로 준비한다
    await tx`create extension if not exists supabase_vault`;
    await tx`create extension if not exists pg_cron`;
    // Supabase 관례: pg_net 은 extensions schema (함수는 어느 쪽이든 net.* 로 생긴다)
    const [ext] = await tx<{ ok: boolean }[]>`
      select exists (select 1 from pg_namespace where nspname = 'extensions') as ok`;
    if (ext?.ok) await tx`create extension if not exists pg_net with schema extensions`;
    else await tx`create extension if not exists pg_net`;
    await upsertVaultSecret(tx, VAULT_SITE_URL, siteUrl);
    await upsertVaultSecret(tx, VAULT_CRON_SECRET, input.cronSecret);
    for (const job of jobs)
      await tx`select cron.schedule(${job.name}, ${job.schedule}, ${jobCommand(job)})`;
  });
  return { jobs: jobs.map((j) => j.name) };
}

export async function uninstallDbScheduler(
  sql: postgres.Sql,
  jobs: readonly DbCronJob[] = DB_CRON_JOBS,
): Promise<{ removed: string[] }> {
  const names = jobs.map((j) => j.name);
  const existing = await sql<{ jobname: string }[]>`
    select jobname from cron.job where jobname = any(${names})`;
  for (const { jobname } of existing) await sql`select cron.unschedule(${jobname})`;
  await sql`delete from vault.secrets where name in (${VAULT_SITE_URL}, ${VAULT_CRON_SECRET})`;
  return { removed: existing.map((r) => r.jobname) };
}

export interface DbSchedulerStatus {
  jobs: Array<{ name: string; schedule: string; active: boolean }>;
  runs: Array<{ job: string; status: string; startedAt: Date | null; endedAt: Date | null }>;
  http: Array<{ id: number; statusCode: number | null; timedOut: boolean | null; createdAt: Date }>;
  vaultSecrets: string[];
}

/** 상태 조회 — 비밀값·요청 헤더·응답 본문은 읽지 않는다 */
export async function dbSchedulerStatus(sql: postgres.Sql, limit = 12): Promise<DbSchedulerStatus> {
  const jobs = await sql<{ name: string; schedule: string; active: boolean }[]>`
    select jobname as name, schedule, active from cron.job where jobname like 'mogo-%' order by jobname`;
  const runs = await sql<DbSchedulerStatus["runs"]>`
    select j.jobname as job, d.status, d.start_time as "startedAt", d.end_time as "endedAt"
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where j.jobname like 'mogo-%' order by d.start_time desc limit ${limit}`;
  const http = await sql<DbSchedulerStatus["http"]>`
    select id, status_code as "statusCode", timed_out as "timedOut", created as "createdAt"
    from net._http_response order by created desc limit ${limit}`;
  const vault = await sql<{ name: string }[]>`
    select name from vault.secrets where name in (${VAULT_SITE_URL}, ${VAULT_CRON_SECRET}) order by name`;
  return { jobs, runs, http, vaultSecrets: vault.map((v) => v.name) };
}
