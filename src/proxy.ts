import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, getAdminConfig, readSession } from "@/lib/server/admin-auth";

/**
 * /admin 보호 (1차 관문). 각 페이지와 server action 에서도 다시 확인한다.
 *  - 관리자 설정이 없으면 404 (production 에서 인증 없이 열리는 일이 없도록)
 *  - 세션이 없으면 로그인 페이지로
 */
export function proxy(request: NextRequest) {
  const config = getAdminConfig();
  if (!config) return new NextResponse("Not found", { status: 404 });
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login") return withSecurityHeaders(NextResponse.next());
  const email = readSession(config, request.cookies.get(ADMIN_COOKIE)?.value);
  if (!email) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return withSecurityHeaders(NextResponse.next());
}

function withSecurityHeaders(response: NextResponse) {
  response.headers.set("x-robots-tag", "noindex, nofollow");
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "same-origin");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
