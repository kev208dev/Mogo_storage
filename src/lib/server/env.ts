/**
 * production 환경변수 검증. 위험한 설정이면 서버를 시작하지 않고(throw),
 * 안전하게 기능만 꺼지는 설정은 경고만 남긴다 (예: 관리자 미설정 → /admin 404).
 * 값 자체는 절대 출력하지 않는다.
 */
export interface EnvCheck {
  errors: string[];
  warnings: string[];
}

export function checkProductionEnv(
  env: Record<string, string | undefined> = process.env,
): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const site = env.NEXT_PUBLIC_SITE_URL ?? "";
  try {
    const url = new URL(site);
    if (url.protocol !== "https:") errors.push("NEXT_PUBLIC_SITE_URL 은 https 여야 합니다");
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname))
      errors.push("NEXT_PUBLIC_SITE_URL 이 localhost 입니다");
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
      errors.push(
        "NEXT_PUBLIC_SITE_URL 은 경로·쿼리 없이 origin 만 적어야 합니다 (canonical 이 어긋남)",
      );
    if (url.username || url.password) errors.push("NEXT_PUBLIC_SITE_URL 에 계정 정보가 있습니다");
  } catch {
    errors.push("NEXT_PUBLIC_SITE_URL 이 없거나 URL 이 아닙니다 (canonical/sitemap 에 필요)");
  }
  if (!env.DATABASE_URL)
    warnings.push("DATABASE_URL 없음 — 내장 샘플 데이터로 동작하며 샘플 페이지는 noindex 입니다");

  const driver = env.STORAGE_DRIVER ?? "mock";
  if (driver === "r2") {
    const canSign =
      env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET;
    if (!canSign && !env.R2_PUBLIC_BASE_URL)
      errors.push("STORAGE_DRIVER=r2 인데 R2 설정이 없습니다 (R2_* 또는 R2_PUBLIC_BASE_URL)");
    const partialSign = [
      env.R2_ACCOUNT_ID,
      env.R2_ACCESS_KEY_ID,
      env.R2_SECRET_ACCESS_KEY,
      env.R2_BUCKET,
    ];
    if (partialSign.some(Boolean) && !partialSign.every(Boolean))
      errors.push(
        "R2 서명 설정(R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET) 중 일부만 있습니다",
      );
    if (env.R2_PUBLIC_BASE_URL && !env.R2_PUBLIC_BASE_URL.startsWith("https://"))
      errors.push("R2_PUBLIC_BASE_URL 은 https 여야 합니다");
  } else if (driver === "mock") {
    warnings.push(
      "STORAGE_DRIVER=mock — mirror/생성 자료 저장소가 없습니다 (source_redirect 다운로드는 정상)",
    );
  } else {
    errors.push(`알 수 없는 STORAGE_DRIVER: ${driver}`);
  }

  for (const flag of ["INGESTION_ENABLED", "GRADE_CUT_INGESTION_ENABLED"]) {
    if (env[flag] !== "true") continue;
    if (!env.DATABASE_URL) errors.push(`${flag}=true 에는 DATABASE_URL 이 필요합니다`);
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 16)
      errors.push(`${flag}=true 에는 16자 이상 CRON_SECRET 이 필요합니다`);
  }
  if (
    env.INGESTION_ENABLED !== "true" &&
    env.GRADE_CUT_INGESTION_ENABLED !== "true" &&
    env.CRON_SECRET &&
    env.CRON_SECRET.length < 16
  ) {
    warnings.push("CRON_SECRET 이 16자 미만이라 cron endpoint 가 꺼져 있습니다");
  }

  const adminVars = ["ADMIN_EMAIL_ALLOWLIST", "ADMIN_ACCESS_TOKEN", "ADMIN_SESSION_SECRET"];
  const adminSet = adminVars.filter((k) => env[k]);
  if (adminSet.length === 0) warnings.push("관리자 설정 없음 — /admin 은 404 입니다");
  else if (adminSet.length < 3)
    errors.push(`관리자 설정이 일부만 있습니다 (${adminVars.length}개 중 ${adminSet.length}개)`);
  else if ((env.ADMIN_ACCESS_TOKEN ?? "").length < 24)
    errors.push("ADMIN_ACCESS_TOKEN 이 너무 짧습니다 (24자 이상)");
  else if ((env.ADMIN_SESSION_SECRET ?? "").length < 32)
    errors.push("ADMIN_SESSION_SECRET 이 너무 짧습니다 (32자 이상)");
  else if (
    !(env.ADMIN_EMAIL_ALLOWLIST ?? "")
      .split(",")
      .some((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()))
  )
    errors.push("ADMIN_EMAIL_ALLOWLIST 에 올바른 이메일이 없습니다");

  if (env.ALLOW_SAMPLE_INDEXING === "1") {
    if (env.DATABASE_URL)
      errors.push(
        "ALLOW_SAMPLE_INDEXING=1 은 운영(DB 연결)에서 쓸 수 없습니다 — 샘플이 색인됩니다",
      );
    else
      warnings.push("ALLOW_SAMPLE_INDEXING=1 — 샘플 페이지가 색인됩니다 (운영에서는 쓰지 마세요)");
  }
  if (env.OPS_WEBHOOK_URL && !env.OPS_WEBHOOK_URL.startsWith("https://"))
    warnings.push("OPS_WEBHOOK_URL 은 https 여야 합니다 (무시됨)");
  return { errors, warnings };
}

export function assertProductionEnv(env: Record<string, string | undefined> = process.env) {
  const { errors, warnings } = checkProductionEnv(env);
  for (const w of warnings) console.warn(JSON.stringify({ event: "env.warning", message: w }));
  if (errors.length) {
    for (const e of errors) console.error(JSON.stringify({ event: "env.error", message: e }));
    throw new Error(`invalid production environment: ${errors.length} error(s)`);
  }
}

/** 검증 실패 시 이유(값 제외)를 남기고 프로세스를 종료한다 (Node 런타임 전용) */
export function enforceProductionEnv(env: Record<string, string | undefined> = process.env) {
  try {
    assertProductionEnv(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "env.invalid",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  }
}
