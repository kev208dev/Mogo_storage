CREATE TABLE "course_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"course_id" text NOT NULL,
	"source_id" text,
	"created_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"subject" "subject" NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"course_id" text NOT NULL,
	"question_count" smallint,
	"total_score" smallint
);
--> statement-breakpoint
DROP INDEX "exam_files_exam_subject_type_uq";--> statement-breakpoint
DROP INDEX "grade_cuts_exam_subject_source_uq";--> statement-breakpoint
DROP INDEX "questions_exam_subject_number_uq";--> statement-breakpoint
DROP INDEX "source_artifacts_slot_uq";--> statement-breakpoint
ALTER TABLE "exam_files" ADD COLUMN "course_id" text;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "live_fixture_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "live_fixture_hash" text;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "live_fixture_parser_version" text;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "verified_against_live_fixture" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "verified_fixture_hash" text;--> statement-breakpoint
ALTER TABLE "exam_sources" ADD COLUMN "verified_parser_version" text;--> statement-breakpoint
ALTER TABLE "grade_cuts" ADD COLUMN "course_id" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "course_id" text;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "course_id" text;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "slot_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "course_label" text;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "container_type" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "contains_multiple_courses" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course_aliases" ADD CONSTRAINT "course_aliases_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_aliases" ADD CONSTRAINT "course_aliases_source_id_exam_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."exam_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_courses" ADD CONSTRAINT "exam_courses_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_courses" ADD CONSTRAINT "exam_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_aliases_global_uq" ON "course_aliases" USING btree ("alias") WHERE "course_aliases"."source_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_aliases_source_uq" ON "course_aliases" USING btree ("alias","source_id") WHERE "course_aliases"."source_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_code_uq" ON "courses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "courses_subject_idx" ON "courses" USING btree ("subject");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_courses_exam_course_uq" ON "exam_courses" USING btree ("exam_id","course_id");--> statement-breakpoint
ALTER TABLE "exam_files" ADD CONSTRAINT "exam_files_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_cuts" ADD CONSTRAINT "grade_cuts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD CONSTRAINT "source_artifacts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_files_slot_no_course_uq" ON "exam_files" USING btree ("exam_id","subject","type") WHERE "exam_files"."course_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_files_slot_course_uq" ON "exam_files" USING btree ("exam_id","subject","course_id","type") WHERE "exam_files"."course_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "grade_cuts_source_no_course_uq" ON "grade_cuts" USING btree ("exam_id","subject","source") WHERE "grade_cuts"."course_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "grade_cuts_source_course_uq" ON "grade_cuts" USING btree ("exam_id","subject","course_id","source") WHERE "grade_cuts"."course_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "questions_number_no_course_uq" ON "questions" USING btree ("exam_id","subject","question_number") WHERE "questions"."course_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "questions_number_course_uq" ON "questions" USING btree ("exam_id","subject","course_id","question_number") WHERE "questions"."course_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_artifacts_slot_key_uq" ON "source_artifacts" USING btree ("source_id","exam_id","subject","type","slot_key");--> statement-breakpoint
-- 세부과목 카탈로그 (src/lib/courses.ts 와 동일해야 한다. tests/unit/course-catalog.test.ts 가 확인)
-- 기존 사회/과학 데이터는 course_id = NULL 로 그대로 두며, 특정 과목으로 임의 mapping 하지 않는다.
INSERT INTO "courses" ("id", "code", "name", "subject", "display_order") VALUES
  ('speech-and-writing', 'speech-and-writing', '화법과 작문', 'korean', 10),
  ('language-and-media', 'language-and-media', '언어와 매체', 'korean', 20),
  ('probability-and-statistics', 'probability-and-statistics', '확률과 통계', 'math', 10),
  ('calculus', 'calculus', '미적분', 'math', 20),
  ('geometry', 'geometry', '기하', 'math', 30),
  ('integrated-social', 'integrated-social', '통합사회', 'social', 5),
  ('life-and-ethics', 'life-and-ethics', '생활과 윤리', 'social', 10),
  ('ethics-and-thought', 'ethics-and-thought', '윤리와 사상', 'social', 20),
  ('korean-geography', 'korean-geography', '한국지리', 'social', 30),
  ('world-geography', 'world-geography', '세계지리', 'social', 40),
  ('east-asian-history', 'east-asian-history', '동아시아사', 'social', 50),
  ('world-history', 'world-history', '세계사', 'social', 60),
  ('economics', 'economics', '경제', 'social', 70),
  ('politics-and-law', 'politics-and-law', '정치와 법', 'social', 80),
  ('social-culture', 'social-culture', '사회·문화', 'social', 90),
  ('integrated-science', 'integrated-science', '통합과학', 'science', 5),
  ('physics-1', 'physics-1', '물리학 I', 'science', 10),
  ('chemistry-1', 'chemistry-1', '화학 I', 'science', 20),
  ('life-science-1', 'life-science-1', '생명과학 I', 'science', 30),
  ('earth-science-1', 'earth-science-1', '지구과학 I', 'science', 40),
  ('physics-2', 'physics-2', '물리학 II', 'science', 50),
  ('chemistry-2', 'chemistry-2', '화학 II', 'science', 60),
  ('life-science-2', 'life-science-2', '생명과학 II', 'science', 70),
  ('earth-science-2', 'earth-science-2', '지구과학 II', 'science', 80)
ON CONFLICT ("id") DO NOTHING;
