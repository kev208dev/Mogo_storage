CREATE TABLE "official_url_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"file_name" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "official_url_imports_created_idx" ON "official_url_imports" USING btree ("created_at");