import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ADMIN_COOKIE, getAdminConfig, readSession } from "./admin-auth";

/** 모든 관리자 페이지/Server Action 에서 호출 (proxy 와 별개의 2차 확인) */
export async function requireAdmin(): Promise<string> {
  const config = getAdminConfig();
  if (!config) notFound();
  const email = readSession(config, (await cookies()).get(ADMIN_COOKIE)?.value);
  if (!email) redirect("/admin/login");
  return email;
}
