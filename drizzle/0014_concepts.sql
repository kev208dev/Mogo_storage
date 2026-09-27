CREATE TABLE "concepts" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" "subject" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_concepts" (
	"question_id" text NOT NULL,
	"concept_id" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"confidence" real NOT NULL,
	"evidence" text,
	"review_reason" text,
	"source_file_id" text,
	"source_url" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_concepts_status_ck" CHECK ("question_concepts"."status" in ('approved', 'manual_review', 'rejected')),
	CONSTRAINT "question_concepts_confidence_ck" CHECK ("question_concepts"."confidence" >= 0 and "question_concepts"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_concepts" ADD CONSTRAINT "question_concepts_source_file_id_exam_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."exam_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_subject_slug_uq" ON "concepts" USING btree ("subject","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "question_concepts_pk_uq" ON "question_concepts" USING btree ("question_id","concept_id");--> statement-breakpoint
CREATE INDEX "question_concepts_concept_idx" ON "question_concepts" USING btree ("concept_id","status");--> statement-breakpoint
CREATE INDEX "question_concepts_status_idx" ON "question_concepts" USING btree ("status");