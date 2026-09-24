import { redactUrl } from "./errors";

export type IngestionEvent =
  | "ingestion.started"
  | "ingestion.completed"
  | "ingestion.failed"
  | "ingestion.skipped"
  | "ingestion.partial"
  | "exam.discovered"
  | "artifact.discovered"
  | "artifact.verified"
  | "artifact.rejected"
  | "artifact.published"
  | "artifact.changed"
  | "artifact.manual_review"
  | "job.failed"
  | "job.retry_scheduled"
  | "source.health"
  | "source.structure_changed"
  | "release_watch.missed"
  | "vocabulary.extracted"
  | "vocabulary.pdf_generated"
  | "release_watch.tick";

type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /(secret|token|password|authorization|cookie|signature|credential|key$)/i;

/** URL 값의 query string 과 민감한 키를 제거한 사본 */
export function sanitizeFields(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key) && key !== "storageKey") {
      out[key] = "[redacted]";
    } else if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      out[key] = redactUrl(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface IngestionLogger {
  info(event: IngestionEvent, fields?: Fields): void;
  warn(event: IngestionEvent, fields?: Fields): void;
  error(event: IngestionEvent, fields?: Fields): void;
}

/** 한 줄 JSON structured log */
export function createLogger(
  write: (line: string) => void = (l) => console.log(l),
): IngestionLogger {
  const emit = (level: string, event: IngestionEvent, fields: Fields = {}) =>
    write(
      JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitizeFields(fields) }),
    );
  return {
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
  };
}

/** 테스트용: 이벤트를 배열에 모은다 */
export function createMemoryLogger() {
  const lines: Array<{ level: string; event: string } & Fields> = [];
  const logger = createLogger((line) => lines.push(JSON.parse(line)));
  return { logger, lines };
}

export const silentLogger: IngestionLogger = { info() {}, warn() {}, error() {} };
