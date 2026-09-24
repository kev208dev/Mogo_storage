ALTER TYPE "public"."source_health_status" ADD VALUE 'unverified';--> statement-breakpoint
ALTER TYPE "public"."source_health_status" ADD VALUE 'structure_changed';--> statement-breakpoint
ALTER TYPE "public"."source_health_status" ADD VALUE 'network_error';--> statement-breakpoint
CREATE TABLE "backfill_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"from_year" smallint NOT NULL,
	"to_year" smallint NOT NULL,
	"passed" boolean NOT NULL,
	"blocking_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "discovery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "artifact_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "release_watch_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backfill_audits" ADD CONSTRAINT "backfill_audits_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backfill_audits_source_idx" ON "backfill_audits" USING btree ("source_id","created_at");