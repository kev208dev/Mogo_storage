"use server";

import { resolveDuplicatePendingImports } from "@/ingestion/manual-import/review";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { exams, ingestionErrors, jobs } from "@/db/schema";
import {
  approveArtifact,
  mapArtifactCourse,
  rejectArtifact,
  remapSourceExam,
  retryArtifact,
  retryFailedJob,
  reviewVocabularyCandidate,
  setReportStatus,
  toggleSource,
} from "@/ingestion/admin-actions";
import { dismissFailedJob } from "@/ingestion/jobs/queue";
import { runJobs } from "@/ingestion/jobs/worker";
import { runDiscovery } from "@/ingestion/pipeline/discovery";
import {
  approveLiveVerification,
  loadSource,
  recordHealthCheck,
  revokeLiveVerification,
  setSourceCapability,
  syncBuiltinSources,
} from "@/ingestion/pipeline/sources";
import { SOURCE_CAPABILITIES, type SourceCapability } from "@/ingestion/constants";
import { IngestionError } from "@/ingestion/errors";
import {
  approveImportedArtifacts,
  importOfficialUrls,
  rejectImportedArtifacts,
} from "@/ingestion/manual-import/import";
import { createAdapter } from "@/ingestion/sources/registry";
import { canRun } from "@/ingestion/sources/verification";
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

/** 로그인 실패 제한: IP 당 15분에 실패 5회 (성공한 로그인은 세지 않는다). 차단 중에는 올바른 토큰도 받지 않는다 */
const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const config = getAdminConfig();
  if (!config) notFound();
  const ip = hashIp(getClientIp(await headers()));
  if (loginLimiter.isBlocked(ip))
    return { error: "시도가 너무 많습니다. 15분 후 다시 시도해 주세요." };
  const email = verifyCredentials(
    config,
    String(form.get("email") ?? ""),
    String(form.get("token") ?? ""),
  );
  if (!email) {
    loginLimiter.record(ip);
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

/** 운영자가 이해할 수 있는 오류는 대시보드 안내로 돌려준다 (redirect 는 try 밖에서) */
async function withNotice(path: string, fn: () => Promise<string | void>) {
  let message: string;
  try {
    message = (await fn()) ?? "처리했습니다.";
  } catch (error) {
    if (error instanceof IngestionError) message = error.message;
    else throw error;
  }
  revalidatePath(path);
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

export async function toggleSourceAction(form: FormData) {
  const { ctx, admin } = await context();
  const sourceId = id(form);
  const enabled = form.get("enabled") === "true";
  await withNotice("/admin", async () => {
    await toggleSource(ctx, sourceId, enabled);
    audit(admin, enabled ? "source.enable" : "source.disable", sourceId);
    return `${sourceId}: 자동 수집을 ${enabled ? "켰습니다" : "껐습니다"}.`;
  });
}

/** 기능 단위 켜기/끄기 (discovery → artifacts → release_watch) */
export async function toggleCapabilityAction(form: FormData) {
  const { ctx, admin } = await context();
  const sourceId = id(form);
  const capability = String(form.get("capability") ?? "");
  const on = form.get("on") === "true";
  await withNotice("/admin", async () => {
    if (!(SOURCE_CAPABILITIES as readonly string[]).includes(capability))
      throw new IngestionError("INVALID", "알 수 없는 기능입니다.");
    await setSourceCapability(ctx.db, sourceId, capability as SourceCapability, on);
    audit(admin, `source.capability.${on ? "on" : "off"}`, `${sourceId}:${capability}`);
    return `${sourceId}: ${capability} ${on ? "켜짐" : "꺼짐"}`;
  });
}

/** 실제 공식 사이트 health check (요청 1회). 결과는 source 활성화 조건으로 기록된다 */
export async function runHealthCheckAction(form: FormData) {
  const { ctx, admin } = await context();
  await withNotice("/admin", async () => {
    const source = await loadSource(ctx.db, id(form));
    if (!source) throw new IngestionError("NOT_FOUND", "source not found");
    const health = await createAdapter({ ...source, enabled: true }).healthCheck();
    await recordHealthCheck(ctx.db, source.id, health);
    audit(admin, "source.health_check", `${source.id}:${health.status}`);
    return `${source.name}: health ${health.status} — ${health.message}`;
  });
}

/** 실제 fixture 검증 증거를 확인하고 승인 (parser 버전에 묶임) */
export async function approveVerificationAction(form: FormData) {
  const { ctx, admin } = await context();
  const sourceId = id(form);
  await withNotice("/admin", async () => {
    await approveLiveVerification(ctx.db, sourceId, admin);
    audit(admin, "source.verify_approve", sourceId);
    return `${sourceId}: 실제 구조 검증을 승인했습니다. 필요하면 자동 수집을 켜세요.`;
  });
}

export async function revokeVerificationAction(form: FormData) {
  const { ctx, admin } = await context();
  const sourceId = id(form);
  await withNotice("/admin", async () => {
    await revokeLiveVerification(ctx.db, sourceId);
    audit(admin, "source.verify_revoke", sourceId);
    return `${sourceId}: 검증을 취소하고 자동 수집을 껐습니다.`;
  });
}

/** source 수동 재수집 (최근 2년) + job 처리 — 실제 구조 검증이 끝난 source 만 */
export async function runSourceNowAction(form: FormData) {
  const { ctx, admin } = await context();
  await withNotice("/admin", async () => {
    await syncBuiltinSources(ctx.db);
    const source = await loadSource(ctx.db, id(form));
    if (!source) throw new IngestionError("NOT_FOUND", "source not found");
    if (!canRun(source, "discovery")) {
      throw new IngestionError(
        "SOURCE_NOT_VERIFIED",
        `${source.name}: 실제 페이지 fixture 검증·승인, source 켜기, discovery 기능이 필요합니다.`,
      );
    }
    const year = new Date().getFullYear();
    audit(admin, "source.run", source.id);
    const result = await runDiscovery(ctx, {
      source,
      mode: "manual_retry",
      options: { fromYear: year - 1, toYear: year },
      artifacts: canRun(source, "artifacts") ? "full" : "none",
    });
    await runJobs(ctx, { timeBudgetMs: 60_000 });
    return `${source.name}: ${result.status} (발견 ${result.counts.discovered}, 신규 ${result.counts.created})`;
  });
}

/** 과목이 모호한 자료에 세부과목 지정 → alias 저장 → (검증된 자료면) 바로 게시 */
export async function mapCourseAction(form: FormData) {
  const { ctx, admin } = await context();
  const courseCode = String(form.get("course") ?? "");
  const scope = form.get("scope") === "global" ? "global" : "source";
  await withNotice("/admin/review", async () => {
    if (!/^[a-z0-9-]{1,60}$/.test(courseCode))
      throw new IngestionError("INVALID", "과목을 선택하세요.");
    const result = await mapArtifactCourse(ctx, {
      artifactId: id(form),
      courseCode,
      admin,
      aliasScope: scope,
      regimeOnly: form.get("regimeOnly") === "1",
    });
    audit(admin, "artifact.map_course", `${id(form)} -> ${courseCode}`);
    await runJobs(ctx, { timeBudgetMs: 30_000 });
    return `과목을 ${courseCode} 로 지정했습니다 (${result.status === "ready" ? "게시 처리됨" : result.status}). 같은 표기는 다음 수집부터 자동으로 적용됩니다.`;
  });
}

export async function retryJobAction(form: FormData) {
  const { ctx, admin } = await context();
  await retryFailedJob(ctx.db, id(form));
  audit(admin, "job.retry", id(form));
  await runJobs(ctx, { timeBudgetMs: 30_000 });
  revalidatePath("/admin");
}

/** 영구 실패 job 무시 (재시도하지 않음) */
export async function dismissJobAction(form: FormData) {
  const { ctx, admin } = await context();
  await withNotice("/admin", async () => {
    const ok = await dismissFailedJob(ctx.db, id(form), ctx.now());
    if (!ok)
      throw new IngestionError("INVALID_STATE", "영구 실패 상태의 job 만 무시할 수 있습니다.");
    audit(admin, "job.dismiss", id(form));
    return "job 을 무시 처리했습니다.";
  });
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
  await withNotice("/admin/review", async () => {
    await approveArtifact(ctx, id(form));
    audit(admin, "artifact.approve", id(form));
    await runJobs(ctx, { timeBudgetMs: 30_000 });
    return "승인했습니다.";
  });
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

const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * 공식 URL CSV 입력 (붙여넣기 또는 파일). 서버는 URL 에 요청하지 않는다 — 형식·공식 도메인만 검사하고
 * 모두 manual_review 로 저장한다. "검사만" 을 체크하면 DB 를 바꾸지 않는다.
 */
export async function importOfficialUrlsAction(form: FormData) {
  const { ctx, admin } = await context();
  await withNotice("/admin/imports", async () => {
    const file = form.get("file");
    let csv = String(form.get("csv") ?? "");
    let fileName: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_CSV_BYTES) throw new IngestionError("TOO_LARGE", "CSV 는 2MB 까지입니다");
      csv = await file.text();
      fileName = file.name.slice(0, 200);
    }
    if (!csv.trim()) throw new IngestionError("EMPTY_CSV", "CSV 를 붙여넣거나 파일을 선택하세요");
    if (csv.length > MAX_CSV_BYTES) throw new IngestionError("TOO_LARGE", "CSV 는 2MB 까지입니다");
    const dryRun = form.get("dryRun") === "1";
    const result = await importOfficialUrls(ctx.db, {
      csv,
      admin,
      fileName,
      dryRun,
      now: ctx.now(),
    });
    audit(admin, dryRun ? "import.dry_run" : "import.official_urls", JSON.stringify(result.counts));
    const c = result.counts;
    const errors = result.rows
      .filter((r) => r.status === "invalid")
      .slice(0, 3)
      .map((r) => `${r.line}행: ${r.errors?.join("; ")}`)
      .join(" / ");
    return `${dryRun ? "[검사만] " : ""}신규 ${c.created} · 변경 ${c.updated} · 동일 ${c.unchanged} · 오류 ${c.invalid}${errors ? ` — ${errors}` : ""}`;
  });
}

/** 선택한 입력 자료 승인 (브라우저에서 공식 URL 을 열어 확인했다는 체크 필수) → redirect 로 게시 */
export async function approveImportsAction(form: FormData) {
  const { ctx, admin } = await context();
  await withNotice("/admin/imports", async () => {
    const ids = form
      .getAll("ids")
      .map(String)
      .filter((v) => /^[\w-]{1,64}$/.test(v));
    if (ids.length === 0) throw new IngestionError("INVALID", "승인할 자료를 선택하세요");
    const result = await approveImportedArtifacts(ctx, {
      artifactIds: ids,
      admin,
      browserChecked: form.get("browserChecked") === "1",
    });
    audit(admin, "import.approve", `${ids.length} selected, ${result.published} published`);
    return `게시 ${result.published}건${result.skipped.length ? ` · 건너뜀 ${result.skipped.length}건 (${result.skipped[0]!.reason})` : ""}`;
  });
}

export async function rejectImportsAction(form: FormData) {
  const { ctx, admin } = await context();
  await withNotice("/admin/imports", async () => {
    const ids = form
      .getAll("ids")
      .map(String)
      .filter((v) => /^[\w-]{1,64}$/.test(v));
    if (ids.length === 0) throw new IngestionError("INVALID", "거절할 자료를 선택하세요");
    const reason = String(form.get("reason") ?? "").trim() || "공식 파일이 아니거나 URL 오류";
    const n = await rejectImportedArtifacts(ctx, { artifactIds: ids, admin, reason });
    audit(admin, "import.reject", `${n}`);
    return `거절 ${n}건`;
  });
}

/** 확정적인 중복만 정리: 같은 슬롯에 같은 공식 URL 이 이미 게시된 검토 대기 건 (다른 경우는 사람이 판단) */
export async function resolveDuplicateImportsAction() {
  const { ctx, admin } = await context();
  await withNotice("/admin/imports", async () => {
    const { resolved } = await resolveDuplicatePendingImports(ctx, admin);
    audit(admin, "import.resolve_duplicates", `${resolved}`);
    return `확정적 중복 ${resolved}건 정리`;
  });
}
