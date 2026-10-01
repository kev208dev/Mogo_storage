ALTER TYPE "public"."file_type" ADD VALUE 'vocabulary_test';--> statement-breakpoint
ALTER TYPE "public"."file_type" ADD VALUE 'vocabulary_test_answers';--> statement-breakpoint
ALTER TYPE "public"."file_type" ADD VALUE 'dictation_sheet';--> statement-breakpoint
ALTER TYPE "public"."file_type" ADD VALUE 'dictation_answers';--> statement-breakpoint
ALTER TYPE "public"."file_type" ADD VALUE 'question_checklist';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'generate_study_materials';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'extract_listening_script';--> statement-breakpoint
CREATE TABLE "study_materials" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"kind" text NOT NULL,
	"slot_key" text DEFAULT '' NOT NULL,
	"question_number" smallint,
	"origin" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_fingerprint" text NOT NULL,
	"storage_key" text,
	"mime_type" text,
	"file_size" integer,
	"sha256" text,
	"file_name" text,
	"exam_file_id" text,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_materials_status_ck" CHECK ("study_materials"."status" in ('draft', 'generated', 'reviewing', 'approved', 'published', 'rejected')),
	CONSTRAINT "study_materials_origin_ck" CHECK ("study_materials"."origin" in ('generated', 'ai_assisted'))
);
--> statement-breakpoint
ALTER TABLE "listening_tracks" ADD COLUMN "timing_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listening_tracks" ADD COLUMN "timing_source" text;--> statement-breakpoint
ALTER TABLE "listening_tracks" ADD COLUMN "timing_verified_by" text;--> statement-breakpoint
ALTER TABLE "listening_tracks" ADD COLUMN "timing_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD COLUMN "origin" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD COLUMN "source_file_id" text;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD COLUMN "parser_version" text;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vocabulary" ADD COLUMN "provenance" text DEFAULT 'solution_extract' NOT NULL;--> statement-breakpoint
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_exam_file_id_exam_files_id_fk" FOREIGN KEY ("exam_file_id") REFERENCES "public"."exam_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_materials_slot_uq" ON "study_materials" USING btree ("exam_id","subject","kind","slot_key");--> statement-breakpoint
CREATE INDEX "study_materials_status_idx" ON "study_materials" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD CONSTRAINT "listening_transcripts_source_file_id_exam_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."exam_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD CONSTRAINT "listening_transcripts_origin_ck" CHECK ("listening_transcripts"."origin" in ('official', 'authorized', 'unverified', 'sample'));--> statement-breakpoint
ALTER TABLE "vocabulary" ADD CONSTRAINT "vocabulary_provenance_ck" CHECK ("vocabulary"."provenance" in ('solution_extract', 'manual', 'ai_assisted'));