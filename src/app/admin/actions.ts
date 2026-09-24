"use server";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { exams, ingestionErrors, jobs } from "@/db/schema";
import {
  approveArtifact,
  rejectArtifact,
  remapSourceExam,
  retryArtifact,
  retryFailedJob,
  reviewVocabularyCandidate,
  setReportStatus,
  toggleSource,
} from "@/ingestion/admin-actions";
import { runJobs } from "@/ingestion/jobs/worker";
import { runDiscovery } from "@/ingestion/pipeline/discovery";
import { loadSource, syncBuiltinSources } from "@/ingestion/pipeline/sources";
import { REPORT_STATUSES, type ReportStatus } from "@/lib/constants";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createSessionValue,
  getAdminConfig,
  verifyCredentials,
} from "@/lib/server/admin-auth";
import { requireAdmin } from "@/lib/server/admin-session";
import { getClientIp, hashIp } from "@/lib/server/client-ip";
import { createAppIngestionContext } from "@/lib/server/ingestion-context";
import { RateLimiter } from "@/lib/server/rate-limit";

const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const config = getAdminConfig();
  if (!config) notFound();
  const ip = hashIp(getClientIp(await headers()));
  if (!loginLimiter.take(ip)) return { error: "시도가 너무 많습니다. 15분 후 다시 시도해 주세요." };
  const email = verifyCredentials(
    config,
    String(form.get("email") ?? ""),
    String(form.get("token") ?? ""),
  );
  if (!email) {
    await new Promise((r) => setTimeout(r, 400));
    return { error: "이메일 또는 접근 토큰이 올바르지 않습니다." };
  }
  (await cookies()).set(ADMIN_COOKIE, createSessionValue(config, email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  console.info(JSON.stringify({ event: "admin.login", email }));
  redirect("/admin");
}

export async function logout() {
  (await cookies()).delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

async function context() {
  const admin = await requireAdmin();
  const ctx = createAppIngestionContext();
  if (!ctx) throw new Error("DATABASE_URL 이 설정되지 않았습니다.");
  return { ctx, admin };
}

function audit(admin: string, action: string, target: string) {
  console.info(JSON.stringify({ event: "admin.action", admin, action, target }));
}

const id = (form: FormData, key = "id") => {
  const value = String(form.get(key) ?? "");
  if (!/^[\w-]{1,100}$/.test(value)) throw new Error("invalid id");
  return value;
};

export async function toggleSourceAction(form: FormData) {
  const { ctx, admin } = await context();
  const sourceId = id(form);
  const enabled = form.get("enabled") === "true";
  await toggleSource(ctx, sourceId, enabled);
  audit(admin, enabled ? "source.enable" : "source.disable", sourceId);
  revalidatePath("/admin");
}

/** source 수동 재수집 (최근 2년) + job 처리 */
export async function runSourceNowAction(form: FormData) {
  const { ctx, admin } = await context();
  await syncBuiltinSources(ctx.db);
  const source = await loadSource(ctx.db, id(form));
  if (!source) throw new Error("source not found");
  const year = new Date().getFullYear();
  audit(admin, "source.run", source.id);
  await runDiscovery(ctx, {
    source: { ...source, enabled: true },
    mode: "manual_retry",
    options: { fromYear: year - 1, toYear: year },
  });
  await runJobs(ctx, { timeBudgetMs: 60_000 });
  revalidatePath("/admin");
}

export async function retryJobAction(form: FormData) {
  const { ctx, admin } = await context();
  await retryFailedJob(ctx.db, id(form));
  audit(admin, "job.retry", id(form));
  await runJobs(ctx, { timeBudgetMs: 30_000 });
  revalidatePath("/admin");
}

export async function retryAllFailedAction() {
  const { ctx, admin } = await context();
  const failed = await ctx.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "failed"));
  for (const job of failed) await retryFailedJob(ctx.db, job.id);
  audit(admin, "job.retry_all", String(failed.length));
  await runJobs(ctx, { timeBudgetMs: 60_000 });
  revalidatePath("/admin");
}

export async function retryArtifactAction(form: FormData) {
  const { ctx, admin } = await context();
  await retryArtifact(ctx, id(form));
  audit(admin, "artifact.retry", id(form));
  await runJobs(ctx, { timeBudgetMs: 30_000 });
  revalidatePath("/admin");
}

export async function resolveErrorsAction() {
  const { ctx, admin } = await context();
  await ctx.db
    .update(ingestionErrors)
    .set({ resolvedAt: new Date() })
    .where(isNull(ingestionErrors.resolvedAt));
  audit(admin, "errors.resolve_all", "*");
  revalidatePath("/admin");
}

export async function approveArtifactAction(form: FormData) {
  const { ctx, admin } = await context();
  await approveArtifact(ctx, id(form));
  audit(admin, "artifact.approve", id(form));
  await runJobs(ctx, { timeBudgetMs: 30_000 });
  revalidatePath("/admin/review");
}

export async function rejectArtifactAction(form: FormData) {
  const { ctx, admin } = await context();
  await rejectArtifact(ctx, id(form), String(form.get("reason") ?? "").slice(0, 200) || "rejected");
  audit(admin, "artifact.reject", id(form));
  revalidatePath("/admin/review");
}

export async function reviewCandidateAction(form: FormData) {
  const { ctx, admin } = await context();
  const approve = form.get("decision") === "approve";
  await reviewVocabularyCandidate(ctx, id(form), approve);
  audit(admin, approve ? "vocabulary.approve" : "vocabulary.reject", id(form));
  revalidatePath("/admin/review");
}

export async function remapAction(form: FormData) {
  const { ctx, admin } = await context();
  const year = Number(form.get("year"));
  const grade = Number(form.get("grade"));
  const month = Number(form.get("month"));
  const [target] = await ctx.db
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.year, year), eq(exams.grade, grade), eq(exams.month, month)));
  if (!target) throw new Error("대상 시험이 없습니다. 먼저 일정/수집으로 시험을 만들어 주세요.");
  await remapSourceExam(ctx, id(form), target.id);
  audit(admin, "mapping.remap", `${id(form)} -> ${target.id}`);
  revalidatePath("/admin/mappings");
}

export async function reportStatusAction(form: FormData) {
  const { ctx, admin } = await context();
  const status = String(form.get("status")) as ReportStatus;
  if (!REPORT_STATUSES.includes(status)) throw new Error("invalid status");
  await setReportStatus(ctx, id(form), status);
  audit(admin, "report.status", `${id(form)}:${status}`);
  revalidatePath("/admin/reports");
}
