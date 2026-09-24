import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminConfig } from "@/lib/server/admin-auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "관리자 로그인",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  if (!getAdminConfig()) notFound();
  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-xl font-bold">관리자 로그인</h1>
      <p className="text-muted-foreground mt-1 text-sm">허용된 운영자만 접근할 수 있습니다.</p>
      <LoginForm />
    </div>
  );
}
