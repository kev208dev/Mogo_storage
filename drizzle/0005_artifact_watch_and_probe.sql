CREATE TABLE "artifact_watch_states" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"course_id" text,
	"slot_key" text DEFAULT '' NOT NULL,
	"type" "file_type" NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"expected_at" timestamp with time zone,
	"official_release_at" timestamp with time zone,
	"expected_source" text DEFAULT 'fallback' NOT NULL,
	"release_source_id" text,
	"last_polled_at" timestamp with time zone,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"found_at" timestamp with time zone,
	"found_source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "verification_mode" text;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "content_fingerprint" text;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "final_url" text;--> statement-breakpoint
ALTER TABLE "artifact_watch_states" ADD CONSTRAINT "artifact_watch_states_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_watch_states" ADD CONSTRAINT "artifact_watch_states_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_watch_states_slot_uq" ON "artifact_watch_states" USING btree ("exam_id","subject","slot_key","type");--> statement-breakpoint
CREATE INDEX "artifact_watch_states_status_idx" ON "artifact_watch_states" USING btree ("status");