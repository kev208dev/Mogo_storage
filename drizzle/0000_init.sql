CREATE TYPE "public"."exam_type" AS ENUM('school_mock', 'kice_mock', 'csat');--> statement-breakpoint
CREATE TYPE "public"."file_type" AS ENUM('question', 'solution', 'listening_audio', 'listening_script', 'vocabulary_pdf');--> statement-breakpoint
CREATE TYPE "public"."grade_cut_source" AS ENUM('official', 'megastudy', 'daesung', 'ebs');--> statement-breakpoint
CREATE TYPE "public"."report_category" AS ENUM('file_broken', 'wrong_question_paper', 'wrong_solution', 'wrong_answer', 'audio_error', 'vocabulary_error', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."subject" AS ENUM('korean', 'math', 'english', 'history', 'social', 'science');--> statement-breakpoint
CREATE TABLE "exam_files" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"type" "file_type" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"original_file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"question_count" smallint NOT NULL,
	"total_score" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"grade" smallint NOT NULL,
	"month" smallint NOT NULL,
	"exam_type" "exam_type" NOT NULL,
	"organizer" text NOT NULL,
	"exam_date" date,
	"slug" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exams_grade_ck" CHECK ("exams"."grade" between 1 and 3),
	CONSTRAINT "exams_month_ck" CHECK ("exams"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "grade_cuts" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"source" "grade_cut_source" NOT NULL,
	"source_url" text,
	"is_official" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"cuts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"file_id" text NOT NULL,
	"question_number" smallint,
	"label" text NOT NULL,
	"start_seconds" real DEFAULT 0 NOT NULL,
	"end_seconds" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listening_transcripts" (
	"id" text PRIMARY KEY NOT NULL,
	"track_id" text NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_statistics" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"correct_rate" real NOT NULL,
	"answer_distribution" jsonb,
	"statistics_source" text NOT NULL,
	"statistics_source_url" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"statistics_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_statistics_rate_ck" CHECK ("question_statistics"."correct_rate" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"subject" "subject" NOT NULL,
	"question_number" smallint NOT NULL,
	"answer" text NOT NULL,
	"choice_count" smallint,
	"score" smallint NOT NULL,
	"explanation" text,
	"solution_page" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"file_id" text,
	"subject" "subject",
	"category" "report_category" NOT NULL,
	"message" text,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"question_id" text NOT NULL,
	"word" text NOT NULL,
	"meaning" text NOT NULL,
	"part_of_speech" text,
	"difficulty" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_files" ADD CONSTRAINT "exam_files_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_cuts" ADD CONSTRAINT "grade_cuts_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_tracks" ADD CONSTRAINT "listening_tracks_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_tracks" ADD CONSTRAINT "listening_tracks_file_id_exam_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."exam_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_transcripts" ADD CONSTRAINT "listening_transcripts_track_id_listening_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."listening_tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_statistics" ADD CONSTRAINT "question_statistics_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_file_id_exam_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."exam_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary" ADD CONSTRAINT "vocabulary_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary" ADD CONSTRAINT "vocabulary_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_files_exam_subject_type_uq" ON "exam_files" USING btree ("exam_id","subject","type");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_files_storage_key_uq" ON "exam_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_subjects_exam_subject_uq" ON "exam_subjects" USING btree ("exam_id","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_slug_uq" ON "exams" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_year_grade_month_uq" ON "exams" USING btree ("year","grade","month");--> statement-breakpoint
CREATE INDEX "exams_grade_idx" ON "exams" USING btree ("grade","year");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_cuts_exam_subject_source_uq" ON "grade_cuts" USING btree ("exam_id","subject","source");--> statement-breakpoint
CREATE UNIQUE INDEX "listening_tracks_exam_number_uq" ON "listening_tracks" USING btree ("exam_id","question_number");--> statement-breakpoint
CREATE UNIQUE INDEX "listening_transcripts_track_uq" ON "listening_transcripts" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_statistics_question_source_uq" ON "question_statistics" USING btree ("question_id","statistics_source");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_exam_subject_number_uq" ON "questions" USING btree ("exam_id","subject","question_number");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_ip_hash_idx" ON "reports" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vocabulary_question_word_uq" ON "vocabulary" USING btree ("question_id","word");--> statement-breakpoint
CREATE INDEX "vocabulary_exam_idx" ON "vocabulary" USING btree ("exam_id");