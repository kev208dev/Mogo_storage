CREATE TABLE "grade_cut_watch_states" (
  "id" text PRIMARY KEY NOT NULL,
  "exam_id" text NOT NULL REFERENCES "exams"("id") ON DELETE cascade,
  "subject" "subject" NOT NULL,
  "course_id" text REFERENCES "courses"("id") ON DELETE restrict,
  "slot_key" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL,
  "started_at" timestamp with time zone,
  "last_polled_at" timestamp with time zone,
  "finalized_at" timestamp with time zone,
  "official_grade_cut_id" text REFERENCES "grade_cuts"("id") ON DELETE set null,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "grade_cut_watch_status_ck" CHECK ("status" in ('waiting', 'watching', 'finalized', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "grade_cut_watch_slot_uq" ON "grade_cut_watch_states" ("exam_id", "subject", "slot_key");
--> statement-breakpoint
CREATE INDEX "grade_cut_watch_status_idx" ON "grade_cut_watch_states" ("status", "last_polled_at");
--> statement-breakpoint
CREATE TABLE "grade_cut_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "grade_cut_id" text NOT NULL REFERENCES "grade_cuts"("id") ON DELETE cascade,
  "exam_id" text NOT NULL REFERENCES "exams"("id") ON DELETE cascade,
  "subject" "subject" NOT NULL,
  "course_id" text REFERENCES "courses"("id") ON DELETE restrict,
  "source" "grade_cut_source" NOT NULL,
  "cuts" jsonb NOT NULL,
  "fingerprint" text NOT NULL,
  "source_url" text,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "grade_cut_snapshots_cut_time_idx" ON "grade_cut_snapshots" ("grade_cut_id", "observed_at");
--> statement-breakpoint
ALTER TABLE "grade_cut_watch_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "grade_cut_snapshots" ENABLE ROW LEVEL SECURITY;
