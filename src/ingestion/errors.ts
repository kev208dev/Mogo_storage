/** 수집 시스템 오류. code 는 ingestion_errors.code 로 저장된다. */
export class IngestionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** source HTML 구조가 parser 의 가정과 달라졌다. 조용히 빈 결과를 내지 않고 반드시 이 오류로 실패한다. */
export class SourceStructureChangedError extends IngestionError {
  constructor(source: string, what: string, details: Record<string, unknown> = {}) {
    super(
      "SOURCE_STRUCTURE_CHANGED",
      `[${source}] page structure changed: ${what}`,
      false,
      details,
    );
  }
}

export class UrlNotAllowedError extends IngestionError {
  constructor(reason: string, url: string) {
    super("URL_NOT_ALLOWED", `URL rejected (${reason}): ${redactUrl(url)}`, false, { reason });
  }
}

export class SourceFetchError extends IngestionError {
  constructor(
    message: string,
    retryable: boolean,
    readonly status?: number,
  ) {
    super(status ? `HTTP_${status}` : "FETCH_FAILED", message, retryable, { status });
  }
}

export class RobotsDisallowedError extends IngestionError {
  constructor(url: string) {
    super("ROBOTS_DISALLOWED", `robots.txt disallows ${redactUrl(url)}`, false);
  }
}

export class ArtifactValidationError extends IngestionError {
  constructor(code: string, message: string) {
    super(code, message, false);
  }
}

/** 로그/DB 에 남길 때 query string(서명, 토큰 등)을 제거한다. */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    const redacted = url.search ? "?[redacted]" : "";
    return `${url.protocol}//${url.host}${url.pathname}${redacted}`;
  } catch {
    return "[invalid-url]";
  }
}

export function toIngestionError(error: unknown): IngestionError {
  if (error instanceof IngestionError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new SourceFetchError("request timed out", true);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new IngestionError("UNEXPECTED", message.slice(0, 500), true);
}

/**
 * 오류 → source health. 구조 변경(사람 확인 필요)과 네트워크 장애(재시도)를 구분한다.
 *  - SOURCE_STRUCTURE_CHANGED, 목록 페이지 404/410, robots.txt 금지 → structure_changed
 *  - timeout, 연결 실패, 5xx, 429, 403(접근 거부 — 우회하지 않는다) → network_error
 */
export function healthStatusForError(error: unknown): "structure_changed" | "network_error" {
  const e = toIngestionError(error);
  if (
    e.code === "SOURCE_STRUCTURE_CHANGED" ||
    e.code === "ROBOTS_DISALLOWED" ||
    e.code === "HTTP_404" ||
    e.code === "HTTP_410" ||
    e.code === "INDEX_EXAM_MISMATCH"
  ) {
    return "structure_changed";
  }
  return "network_error";
}
