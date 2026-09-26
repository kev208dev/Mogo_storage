CREATE TABLE "artifact_review_notes" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"reason_code" text,
	"reason" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_mapping_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"kind" text NOT NULL,
	"pattern" text NOT NULL,
	"grade_scope" text DEFAULT '' NOT NULL,
	"subject" "subject" NOT NULL,
	"course_id" text,
	"created_by" text NOT NULL,
	"approvals" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_review_notes" ADD CONSTRAINT "artifact_review_notes_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."source_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_mapping_rules" ADD CONSTRAINT "review_mapping_rules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_mapping_rules_uq" ON "review_mapping_rules" USING btree ("source_id","kind","pattern","grade_scope");--> statement-breakpoint
CREATE INDEX "source_artifacts_source_url_idx" ON "source_artifacts" USING btree ("source_url");--> statement-breakpoint
CREATE INDEX "source_artifacts_fingerprint_idx" ON "source_artifacts" USING btree ("content_fingerprint");