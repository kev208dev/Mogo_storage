CREATE TYPE "public"."artifact_origin" AS ENUM('official', 'generated');--> statement-breakpoint
CREATE TYPE "public"."artifact_delivery_policy" AS ENUM('mirror_allowed', 'source_redirect', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."exam_schedule_status" AS ENUM('scheduled', 'watching', 'published', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."file_delivery_type" AS ENUM('storage', 'redirect');--> statement-breakpoint
CREATE TYPE "public"."ingestion_mode" AS ENUM('scheduled', 'release_watch', 'backfill', 'manual_retry');--> statement-breakpoint
CREATE TYPE "public"."ingestion_run_status" AS ENUM('running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'retrying');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('verify_artifact', 'publish_artifact', 'extract_vocabulary', 'generate_vocabulary_pdf');--> statement-breakpoint
CREATE TYPE "public"."source_artifact_status" AS ENUM('discovered', 'verifying', 'ready', 'failed', 'changed', 'manual_review', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."source_health_status" AS ENUM('healthy', 'degraded', 'broken', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."exam_source_kind" AS ENUM('ebsi', 'kice', 'education_office', 'other_official');--> statement-breakpoint
CREATE TYPE "public"."vocabulary_candidate_status" AS ENUM('auto_approved', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "exam_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"grade" smallint NOT NULL,
	"month" smallint NOT NULL,
	"exam_type" "exam_type" NOT NULL,
	"organizer" text NOT NULL,
	"exam_date" date NOT NULL,
	"expected_release_start" timestamp with time zone,
	"expected_release_end" timestamp with time zone,
	"status" "exam_schedule_status" DEFAULT 'scheduled' NOT NULL,
	"announcement_url" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"exam_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "exam_source_kind" NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"allowed_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivery_policy" "artifact_delivery_policy" DEFAULT 'source_redirect' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"min_poll_interval_seconds" integer DEFAULT 600 NOT NULL,
	"request_timeout_ms" integer DEFAULT 15000 NOT NULL,
	"max_concurrent_requests" smallint DEFAULT 2 NOT NULL,
	"min_request_gap_ms" integer DEFAULT 1000 NOT NULL,
	"max_retries" smallint DEFAULT 2 NOT NULL,
	"health_status" "source_health_status" DEFAULT 'disabled' NOT NULL,
	"health_message" text,
	"last_health_check_at" timestamp with time zone,
	"last_successful_fetch_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"scope" text NOT NULL,
	"last_cursor" text,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"status" "ingestion_run_status" DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_errors" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"source_id" text,
	"external_id" text,
	"url" text,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"mode" "ingestion_mode" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ingestion_run_status" DEFAULT 'running' NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "job_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"source_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"type" "file_type" NOT NULL,
	"source_url" text NOT NULL,
	"storage_key" text,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer,
	"sha256" text,
	"delivery_policy" "artifact_delivery_policy" NOT NULL,
	"status" "source_artifact_status" DEFAULT 'discovered' NOT NULL,
	"status_reason" text,
	"source_published_at" timestamp with time zone,
	"first_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_exams" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"source_title" text,
	"mapping_locked" boolean DEFAULT false NOT NULL,
	"first_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_priorities" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_type" "exam_type" NOT NULL,
	"source_id" text NOT NULL,
	"priority" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"source_artifact_id" text NOT NULL,
	"question_number" smallint NOT NULL,
	"word" text NOT NULL,
	"meaning" text,
	"confidence" real NOT NULL,
	"status" "vocabulary_candidate_status" DEFAULT 'needs_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "vocabulary_question_word_uq";--> statement-breakpoint
ALTER TABLE "exam_files" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_files" ALTER COLUMN "file_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_subjects" ALTER COLUMN "question_count" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_subjects" ALTER COLUMN "total_score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary" ALTER COLUMN "question_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_files" ADD COLUMN "delivery_type" "file_delivery_type" DEFAULT 'storage' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_files" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "exam_files" ADD COLUMN "artifact_origin" "artifact_origin" DEFAULT 'official' NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_files" ADD COLUMN "source_artifact_id" text;--> statement-breakpoint
ALTER TABLE "exam_files" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "academic_year" smallint;--> statement-breakpoint
-- 평가원 모의평가/수능은 대입 학년도 = 시행 연도 + 1
UPDATE "exams" SET "academic_year" = "year" + 1 WHERE "exam_type" IN ('kice_mock', 'csat') AND "academic_year" IS NULL;--> statement-breakpoint
ALTER TABLE "vocabulary" ADD COLUMN "subject" "subject" DEFAULT 'english' NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary" ADD COLUMN "question_number" smallint;--> statement-breakpoint
-- 기존(1차 MVP) 단어 데이터 보존: 연결된 문항 번호로 채운 뒤 NOT NULL 적용
UPDATE "vocabulary" v SET "question_number" = q."question_number" FROM "questions" q WHERE v."question_id" = q."id" AND v."question_number" IS NULL;--> statement-breakpoint
ALTER TABLE "vocabulary" ALTER COLUMN "question_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary" ADD COLUMN "source_artifact_id" text;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_checkpoints" ADD CONSTRAINT "ingestion_checkpoints_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_errors" ADD CONSTRAINT "ingestion_errors_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_exams" ADD CONSTRAINT "source_exams_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_exams" ADD CONSTRAINT "source_exams_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_priorities" ADD CONSTRAINT "source_priorities_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_candidates" ADD CONSTRAINT "vocabulary_candidates_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_candidates" ADD CONSTRAINT "vocabulary_candidates_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_schedules_identity_uq" ON "exam_schedules" USING btree ("year","grade","month","exam_type");--> statement-breakpoint
CREATE INDEX "exam_schedules_date_idx" ON "exam_schedules" USING btree ("exam_date");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_checkpoints_source_scope_uq" ON "ingestion_checkpoints" USING btree ("source_id","scope");--> statement-breakpoint
CREATE INDEX "ingestion_errors_created_idx" ON "ingestion_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_started_idx" ON "ingestion_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_uq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_artifacts_slot_uq" ON "source_artifacts" USING btree ("source_id","exam_id","subject","type");--> statement-breakpoint
CREATE INDEX "source_artifacts_status_idx" ON "source_artifacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "source_artifacts_exam_idx" ON "source_artifacts" USING btree ("exam_id","subject","type");--> statement-breakpoint
CREATE UNIQUE INDEX "source_exams_source_external_uq" ON "source_exams" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "source_exams_exam_idx" ON "source_exams" USING btree ("exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_priorities_type_source_uq" ON "source_priorities" USING btree ("exam_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vocabulary_candidates_artifact_word_uq" ON "vocabulary_candidates" USING btree ("source_artifact_id","question_number","word");--> statement-breakpoint
ALTER TABLE "exam_files" ADD CONSTRAINT "exam_files_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary" ADD CONSTRAINT "vocabulary_source_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("source_artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vocabulary_exam_number_word_uq" ON "vocabulary" USING btree ("exam_id","subject","question_number","word");--> statement-breakpoint
ALTER TABLE "exam_files" ADD CONSTRAINT "exam_files_delivery_ck" CHECK (("exam_files"."delivery_type" = 'storage' and "exam_files"."storage_key" is not null) or ("exam_files"."delivery_type" = 'redirect' and "exam_files"."external_url" is not null));