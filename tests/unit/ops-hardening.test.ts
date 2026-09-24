import { describe, expect, it, vi } from "vitest";
import { createMemoryLogger } from "@/ingestion/logger";
import {
  createOpsNotifier,
  formatNotification,
  LogOpsNotifier,
  WebhookOpsNotifier,
} from "@/ingestion/notifier";
import { checkProductionEnv } from "@/lib/server/env";
import { assertSafeStorageKey } from "@/lib/storage/types";

describe("운영 알림 (webhook)", () => {
  it("OPS_WEBHOOK_URL 이 없거나 https 가 아니면 로그만 (앱 실행에 영향 없음)", () => {
    const { logger } = createMemoryLogger();
    expect(createOpsNotifier(logger, {})).toBeInstanceOf(LogOpsNotifier);
    expect(createOpsNotifier(logger, { OPS_WEBHOOK_URL: "http://x.example" })).toBeInstanceOf(
      LogOpsNotifier,
    );
    expect(
      createOpsNotifier(logger, { OPS_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" }),
    ).toBeInstanceOf(WebhookOpsNotifier);
  });

  it("필수 알림(구조 변경·공개 후 미발견·job 영구 실패·내용 변경)을 Discord/Slack 호환 JSON 으로 보낸다", async () => {
    const { logger, lines } = createMemoryLogger();
    const calls: Array<{ url: string; body: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("", { status: 204 });
    }) as unknown as typeof fetch;
    const n = new WebhookOpsNotifier(
      "https://hook.example/x",
      new LogOpsNotifier(logger),
      fetchImpl,
    );
    await n.notify({ kind: "source_broken", sourceId: "ebsi", message: "list container missing" });
    await n.notify({
      kind: "release_missed",
      examLabel: "2026 고3 9월",
      items: ["english listening_audio"],
    });
    await n.notify({
      kind: "job_dead",
      jobType: "verify_artifact",
      jobId: "j1",
      message: "HTTP_403",
    });
    await n.notify({
      kind: "artifact_changed",
      examLabel: "2026 고3 9월",
      item: "korean question",
    });
    // 게시 알림은 webhook 으로 보내지 않는다 (로그만)
    await n.notify({ kind: "artifacts_published", examLabel: "x", items: ["a"] });
    expect(calls.map((c) => c.body.event)).toEqual([
      "source_broken",
      "release_missed",
      "job_dead",
      "artifact_changed",
    ]);
    expect(calls[0]!.body.content).toContain("자동 게시 중단");
    expect(lines.map((l) => l.event)).toContain("source.structure_changed");
  });

  it("webhook 실패는 수집을 멈추지 않는다", async () => {
    const { logger } = createMemoryLogger();
    const failing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const n = new WebhookOpsNotifier("https://hook.example/x", new LogOpsNotifier(logger), failing);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      n.notify({ kind: "job_dead", jobType: "x", jobId: "1", message: "m" }),
    ).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("hook.example");
    warn.mockRestore();
  });

  it("formatNotification 는 모든 종류를 한 줄로", () => {
    expect(
      formatNotification({ kind: "repeated_failure", sourceId: null, code: "X", count: 3 }),
    ).toMatch(/반복 실패/);
  });
});

describe("production 환경변수 검증", () => {
  const ok = {
    NEXT_PUBLIC_SITE_URL: "https://mogo.example",
    DATABASE_URL: "postgres://x",
    STORAGE_DRIVER: "r2",
    R2_PUBLIC_BASE_URL: "https://files.example",
    INGESTION_ENABLED: "true",
    CRON_SECRET: "0123456789abcdef0123",
    ADMIN_EMAIL_ALLOWLIST: "ops@example.com",
    ADMIN_ACCESS_TOKEN: "t".repeat(30),
    ADMIN_SESSION_SECRET: "s".repeat(40),
  };
  it("정상 설정은 오류 없음", () => {
    expect(checkProductionEnv(ok).errors).toEqual([]);
  });
  it("위험한 설정은 오류 (서버 시작 안 함)", () => {
    expect(
      checkProductionEnv({ ...ok, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }).errors,
    ).toHaveLength(2);
    expect(checkProductionEnv({ ...ok, CRON_SECRET: "" }).errors.join()).toMatch(/CRON_SECRET/);
    expect(
      checkProductionEnv({ ...ok, INGESTION_ENABLED: "true", DATABASE_URL: "" }).errors.join(),
    ).toMatch(/DATABASE_URL/);
    expect(checkProductionEnv({ ...ok, R2_PUBLIC_BASE_URL: "" }).errors.join()).toMatch(/R2/);
  });
  it("안전하게 꺼지는 기능은 경고만 (관리자 미설정 → /admin 404)", () => {
    const r = checkProductionEnv({
      ...ok,
      ADMIN_ACCESS_TOKEN: "",
      ADMIN_EMAIL_ALLOWLIST: "",
      ADMIN_SESSION_SECRET: "",
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/admin/);
  });
});

describe("storage key", () => {
  it("self-test prefix _internal/ 만 예외로 허용, path traversal 차단", () => {
    expect(() => assertSafeStorageKey("_internal/test/selftest-1.pdf")).not.toThrow();
    expect(() =>
      assertSafeStorageKey("exams/2025/high2/09/english/question-abc.pdf"),
    ).not.toThrow();
    expect(() => assertSafeStorageKey("_other/x.pdf")).toThrow();
    expect(() => assertSafeStorageKey("exams/../secret")).toThrow();
    expect(() => assertSafeStorageKey("/etc/passwd")).toThrow();
  });
});
