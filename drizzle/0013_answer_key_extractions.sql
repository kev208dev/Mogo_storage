CREATE TABLE "answer_key_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"slot_key" text DEFAULT '' NOT NULL,
	"course_id" text,
	"status" text NOT NULL,
	"answers_verified" boolean DEFAULT false NOT NULL,
	"points_verified" boolean DEFAULT false NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"points" jsonb,
	"cross_checked" smallint DEFAULT 0 NOT NULL,
	"solution_file_id" text,
	"question_file_id" text,
	"solution_url" text,
	"solution_sha256" text,
	"parser_version" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answer_key_extractions" ADD CONSTRAINT "answer_key_extractions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_extractions" ADD CONSTRAINT "answer_key_extractions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_extractions" ADD CONSTRAINT "answer_key_extractions_solution_file_id_exam_files_id_fk" FOREIGN KEY ("solution_file_id") REFERENCES "public"."exam_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_key_extractions" ADD CONSTRAINT "answer_key_extractions_question_file_id_exam_files_id_fk" FOREIGN KEY ("question_file_id") REFERENCES "public"."exam_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_key_extractions_slot_uq" ON "answer_key_extractions" USING btree ("exam_id","subject","slot_key");--> statement-breakpoint
CREATE INDEX "answer_key_extractions_status_idx" ON "answer_key_extractions" USING btree ("status");