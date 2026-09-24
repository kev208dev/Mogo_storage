import type { IngestionLogger } from "./logger";

export type OpsNotification =
  | { kind: "artifacts_published"; examLabel: string; items: string[] }
  | { kind: "source_broken"; sourceId: string; message: string }
  | { kind: "repeated_failure"; sourceId: string | null; code: string; count: number }
  | { kind: "manual_review_needed"; examLabel: string; items: string[] };

/**
 * 운영 알림 인터페이스. 기본 구현은 로그만 남긴다.
 * Slack/Discord 등은 이 인터페이스 구현체를 추가해 연결한다.
 */
export interface OpsNotifier {
  notify(notification: OpsNotification): Promise<void>;
}

export class LogOpsNotifier implements OpsNotifier {
  constructor(private readonly logger: IngestionLogger) {}
  async notify(n: OpsNotification) {
    const event = n.kind === "artifacts_published" ? "artifact.published" : "ingestion.failed";
    this.logger.info(event, { notification: n.kind, ...n });
  }
}
