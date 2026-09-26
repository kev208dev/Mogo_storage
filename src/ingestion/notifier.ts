import type { IngestionLogger } from "./logger";
import type { AlertGate } from "./ops/alert-gate";

export type OpsNotification =
  | { kind: "artifacts_published"; examLabel: string; items: string[] }
  | { kind: "source_broken"; sourceId: string; message: string }
  | { kind: "repeated_failure"; sourceId: string | null; code: string; count: number }
  | { kind: "manual_review_needed"; examLabel: string; items: string[] }
  /** 공개 시간대가 끝났는데 자료를 찾지 못함 */
  | { kind: "release_missed"; examLabel: string; items: string[] }
  /** 최대 재시도 후 영구 실패한 job */
  | { kind: "job_dead"; jobType: string; jobId: string; message: string }
  /** 같은 공식 URL 의 내용이 바뀜 */
  | { kind: "artifact_changed"; examLabel: string; item: string }
  /** cron 이 기대 주기보다 오래 실행되지 않음 */
  | { kind: "scheduler_stale"; task: string; label: string; minutesSinceSeen: number | null }
  /** cron 이 연속으로 실패 */
  | { kind: "scheduler_failing"; task: string; label: string; consecutiveFailures: number }
  /** stale/failing 이었던 cron 이 정상으로 돌아옴 */
  | { kind: "scheduler_recovered"; task: string; label: string };

/**
 * 운영 알림 인터페이스. 기본 구현은 로그만 남긴다 (credential 이 없어도 앱은 정상 동작).
 * OPS_WEBHOOK_URL 이 있으면 WebhookOpsNotifier (Discord/Slack 호환 JSON) 로도 보낸다.
 */
export interface OpsNotifier {
  notify(notification: OpsNotification): Promise<void>;
}

export class LogOpsNotifier implements OpsNotifier {
  constructor(private readonly logger: IngestionLogger) {}
  async notify(n: OpsNotification) {
    const event =
      n.kind === "artifacts_published"
        ? "artifact.published"
        : n.kind === "artifact_changed"
          ? "artifact.changed"
          : n.kind === "source_broken"
            ? "source.structure_changed"
            : n.kind === "release_missed"
              ? "release_watch.missed"
              : n.kind === "job_dead"
                ? "job.failed"
                : n.kind === "scheduler_stale" || n.kind === "scheduler_failing"
                  ? "scheduler.unhealthy"
                  : n.kind === "scheduler_recovered"
                    ? "scheduler.recovered"
                    : "ingestion.failed";
    const level =
      n.kind === "artifacts_published" || n.kind === "scheduler_recovered" ? "info" : "warn";
    this.logger[level](event, { notification: n.kind, ...n });
  }
}

/** 사람이 읽는 한 줄 메시지 */
export function formatNotification(n: OpsNotification): string {
  switch (n.kind) {
    case "artifacts_published":
      return `✅ 게시: ${n.examLabel} — ${n.items.join(", ")}`;
    case "source_broken":
      return `🚨 source 구조 변경 의심: ${n.sourceId} — 자동 게시 중단. ${n.message}`;
    case "repeated_failure":
      return `⚠️ 반복 실패: ${n.sourceId ?? "-"} ${n.code} ${n.count}회`;
    case "manual_review_needed":
      return `📝 검토 필요: ${n.examLabel} — ${n.items.join(", ")}`;
    case "release_missed":
      return `⏰ 공개 시간대 종료 후 자료 미발견: ${n.examLabel} — ${n.items.join(", ")}`;
    case "job_dead":
      return `💀 job 영구 실패: ${n.jobType} (${n.jobId}) — ${n.message}`;
    case "artifact_changed":
      return `🔁 공식 자료 내용 변경: ${n.examLabel} — ${n.item}`;
    case "scheduler_stale":
      return `⏳ scheduler 지연: ${n.label} (${n.task}) — ${
        n.minutesSinceSeen === null ? "실행 기록 없음" : `${n.minutesSinceSeen}분째 실행 없음`
      }`;
    case "scheduler_failing":
      return `🚨 scheduler 연속 실패: ${n.label} (${n.task}) — ${n.consecutiveFailures}회`;
    case "scheduler_recovered":
      return `✅ scheduler 복구: ${n.label} (${n.task})`;
  }
}

/**
 * 같은 문제를 가리키는 알림의 dedupe key. null 이면 dedupe 하지 않는다.
 * (같은 cron 의 stale→failing 처럼 원인이 같은 알림은 한 key 로 묶는다)
 */
export function alertKey(n: OpsNotification): string | null {
  switch (n.kind) {
    case "artifacts_published":
    case "scheduler_recovered":
      return null;
    case "source_broken":
      return `source_broken:${n.sourceId}`;
    case "repeated_failure":
      return `repeated_failure:${n.sourceId ?? "-"}:${n.code}`;
    case "manual_review_needed":
      return `manual_review:${n.examLabel}:${[...n.items].sort().join(",")}`;
    case "release_missed":
      return `release_missed:${n.examLabel}:${[...n.items].sort().join(",")}`;
    case "job_dead":
      return `job_dead:${n.jobType}`;
    case "artifact_changed":
      return `artifact_changed:${n.examLabel}:${n.item}`;
    case "scheduler_stale":
    case "scheduler_failing":
      return schedulerAlertKey(n.task);
  }
}

export const schedulerAlertKey = (task: string) => `scheduler:${task}`;

/** 알림 채널로 보낼 종류 (게시 알림은 양이 많아 기본 제외) */
const WEBHOOK_KINDS: OpsNotification["kind"][] = [
  "source_broken",
  "repeated_failure",
  "manual_review_needed",
  "release_missed",
  "job_dead",
  "artifact_changed",
  "scheduler_stale",
  "scheduler_failing",
  "scheduler_recovered",
];

/**
 * 일반 webhook (Discord `content` / Slack `text` 모두 읽을 수 있는 JSON).
 * 실패해도 수집을 멈추지 않는다 (로그만 남김). URL 은 로그에 남기지 않는다.
 */
export class WebhookOpsNotifier implements OpsNotifier {
  constructor(
    private readonly url: string,
    private readonly fallback: OpsNotifier,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
    /** dedupe/cooldown. 없으면 매번 보낸다 */
    private readonly gate?: AlertGate,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async notify(n: OpsNotification) {
    await this.fallback.notify(n);
    if (!WEBHOOK_KINDS.includes(n.kind)) return;
    let text = formatNotification(n);
    const key = alertKey(n);
    if (this.gate && key) {
      const decision = await this.gate.claim({ key, kind: n.kind, message: text, now: this.now() });
      if (!decision.send) {
        console.info(JSON.stringify({ event: "ops.alert_suppressed", kind: n.kind }));
        return;
      }
      if (decision.suppressedSinceLast > 0)
        text += ` (이전 알림 이후 같은 알림 ${decision.suppressedSinceLast}회 생략)`;
    }
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 1900), text, event: n.kind }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok)
        console.warn(JSON.stringify({ event: "ops.webhook_failed", status: res.status }));
    } catch {
      console.warn(JSON.stringify({ event: "ops.webhook_failed", status: "network" }));
    }
  }
}

/** 환경변수에 따라 notifier 구성. OPS_WEBHOOK_URL 이 https 가 아니면 무시한다 */
export function createOpsNotifier(
  logger: IngestionLogger,
  env: Record<string, string | undefined> = process.env,
  gate?: AlertGate,
): OpsNotifier {
  const log = new LogOpsNotifier(logger);
  const url = env.OPS_WEBHOOK_URL?.trim();
  if (!url) return log;
  try {
    if (new URL(url).protocol !== "https:") return log;
  } catch {
    return log;
  }
  return new WebhookOpsNotifier(url, log, fetch, 5000, gate);
}
