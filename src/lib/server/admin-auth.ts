import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 관리자 인증 (학생용 회원가입 없음).
 *  - ADMIN_EMAIL_ALLOWLIST: 허용 이메일 (쉼표 구분)
 *  - ADMIN_ACCESS_TOKEN: 관리자 공용 접근 토큰 (24자 이상)
 *  - ADMIN_SESSION_SECRET: 세션 쿠키 서명 키 (32자 이상)
 * 셋 중 하나라도 없으면 /admin 전체가 비활성(404)된다. 배포 플랫폼 접근 보호와 함께 쓰는 것을 권장.
 */
export const ADMIN_COOKIE = "mogo_admin";
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface AdminConfig {
  allowlist: string[];
  accessToken: string;
  sessionSecret: string;
}

export function getAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig | null {
  const allowlist = (env.ADMIN_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const accessToken = env.ADMIN_ACCESS_TOKEN ?? "";
  const sessionSecret = env.ADMIN_SESSION_SECRET ?? "";
  if (allowlist.length === 0 || accessToken.length < 24 || sessionSecret.length < 32) return null;
  return { allowlist, accessToken, sessionSecret };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyCredentials(
  config: AdminConfig,
  email: string,
  token: string,
): string | null {
  const normalized = email.trim().toLowerCase();
  const emailOk = config.allowlist.includes(normalized);
  const tokenOk = safeEqual(token, config.accessToken);
  return emailOk && tokenOk ? normalized : null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionValue(config: AdminConfig, email: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ e: email, x: Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, config.sessionSecret)}`;
}

/** 서명·만료·allowlist 를 모두 확인. 유효하면 이메일 */
export function readSession(
  config: AdminConfig,
  value: string | undefined,
  now = Date.now(),
): string | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, config.sessionSecret)))
    return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      e?: string;
      x?: number;
    };
    if (!data.e || !data.x || data.x * 1000 < now) return null;
    // allowlist 에서 빠진 관리자는 즉시 차단
    return config.allowlist.includes(data.e) ? data.e : null;
  } catch {
    return null;
  }
}
