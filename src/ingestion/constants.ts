/**
 * 자동 수집 시스템 상수. DB enum(src/db/schema.ts)과 값이 반드시 일치해야 한다.
 * (앱/CLI 양쪽에서 import 하므로 server-only 를 쓰지 않는다)
 */

/**
 * source 상태. HTML 구조 변경과 네트워크 장애를 같은 값으로 묶지 않는다.
 *  - unverified: 실제 페이지 fixture 로 검증·승인되지 않음 (자동 수집 불가)
 *  - healthy: 요청·파싱 정상
 *  - degraded: 일부 실패(부분 성공) — 계속 시도
 *  - structure_changed: 페이지 구조/정책(robots, 404 등)이 parser 가정과 달라짐 → 사람이 확인 전까지 중단
 *  - network_error: timeout, 5xx, 429, 접근 거부 등 일시/외부 장애 → 나중에 재시도
 *  - disabled: 운영자가 끔
 *  - broken: 이전 버전 값 (structure_changed 로 표시). DB enum 에서 값을 지울 수 없어 남겨 둔다
 * enum 순서는 migration(ALTER TYPE ADD VALUE) 순서와 같아야 한다.
 */
export const SOURCE_HEALTH_STATUSES = [
  "healthy",
  "degraded",
  "broken",
  "disabled",
  "unverified",
  "structure_changed",
  "network_error",
] as const;
export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

/** source 기능 단위 활성화 (단계적으로 켠다: discovery → artifacts → release_watch) */
export const SOURCE_CAPABILITIES = ["discovery", "artifacts", "release_watch"] as const;
export type SourceCapability = (typeof SOURCE_CAPABILITIES)[number];

export const SOURCE_ARTIFACT_STATUSES = [
  "discovered",
  "verifying",
  "ready",
  "failed",
  "changed",
  "manual_review",
  "unavailable",
] as const;
export type SourceArtifactStatus = (typeof SOURCE_ARTIFACT_STATUSES)[number];

export const INGESTION_MODES = ["scheduled", "release_watch", "backfill", "manual_retry"] as const;
export type IngestionMode = (typeof INGESTION_MODES)[number];

export const INGESTION_RUN_STATUSES = ["running", "completed", "partial", "failed"] as const;
export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

export const EXAM_SCHEDULE_STATUSES = [
  "scheduled",
  "watching",
  "published",
  "completed",
  "cancelled",
] as const;
export type ExamScheduleStatus = (typeof EXAM_SCHEDULE_STATUSES)[number];

/** 처리 단계: DISCOVER(run) → VERIFY → MIRROR/REGISTER_URL → PUBLISH → PROCESS */
export const JOB_TYPES = [
  "verify_artifact",
  "publish_artifact",
  "extract_vocabulary",
  "generate_vocabulary_pdf",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["pending", "processing", "completed", "failed", "retrying"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const VOCABULARY_CANDIDATE_STATUSES = [
  "auto_approved",
  "needs_review",
  "approved",
  "rejected",
] as const;
export type VocabularyCandidateStatus = (typeof VOCABULARY_CANDIDATE_STATUSES)[number];

/** 단어 후보 자동 승인 기준 */
export const VOCABULARY_AUTO_APPROVE_CONFIDENCE = 0.8;
