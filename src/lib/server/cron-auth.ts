import { timingSafeEqual } from "node:crypto";

/**
 * cron/내부 endpoint 인증. Authorization: Bearer <CRON_SECRET>
 * (Vercel Cron 은 CRON_SECRET 을 이 형식으로 보낸다.) CRON_SECRET 이 없으면 endpoint 자체를 끈다.
 */
export function checkCronAuth(request: Request): "ok" | "disabled" | "unauthorized" {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return "disabled";
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
