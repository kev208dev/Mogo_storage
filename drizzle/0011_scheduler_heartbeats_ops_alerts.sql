CREATE TABLE "ops_alert_states" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL,
	"last_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_heartbeats" (
	"task" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_status" text,
	"last_detail" text,
	"last_duration_ms" integer,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
