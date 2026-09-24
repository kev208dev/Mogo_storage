/**
 * 자동 수집 시스템 상수. DB enum(src/db/schema.ts)과 값이 반드시 일치해야 한다.
 * (앱/CLI 양쪽에서 import 하므로 server-only 를 쓰지 않는다)
 */

export const SOURCE_HEALTH_STATUSES = ["healthy", "degraded", "broken", "disabled"] as const;
export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

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
