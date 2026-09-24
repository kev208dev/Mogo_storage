import { createHash } from "node:crypto";

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "unknown";
}

/** 원본 IP 대신 저장하는 해시 (일 단위 salt → 장기 추적 방지) */
export function hashIp(ip: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return createHash("sha256").update(`mogo:${day}:${ip}`).digest("hex").slice(0, 32);
}
