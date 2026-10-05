import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "../actions";
import { requireAdmin } from "@/lib/server/admin-session";

export const metadata: Metadata = {
  title: "운영 대시보드",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/admin", label: "수집 현황" },
  { href: "/admin/review", label: "검토 대기" },
  { href: "/admin/imports", label: "공식 URL 입력" },
  { href: "/admin/grade-cuts", label: "등급컷" },
  { href: "/admin/concepts", label: "개념 태그" },
  { href: "/admin/study", label: "학습 자료" },
  { href: "/admin/schedules", label: "시험 일정" },
  { href: "/admin/coverage", label: "기능 coverage" },
  { href: "/admin/mappings", label: "Source mapping" },
  { href: "/admin/runs", label: "실행 기록" },
  { href: "/admin/reports", label: "오류 신고" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const email = await requireAdmin();
  return (
    <div className="py-4">
      <div className="border-border mb-4 flex flex-wrap items-center gap-2 border-b pb-3">
        <nav aria-label="관리자 메뉴" className="flex flex-wrap gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:bg-muted inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form
          action={logout}
          className="text-muted-foreground ml-auto flex items-center gap-2 text-xs"
        >
          <span>{email}</span>
          <button
            type="submit"
            className="border-border hover:bg-muted min-h-9 rounded-md border px-2 font-semibold"
          >
            로그아웃
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
