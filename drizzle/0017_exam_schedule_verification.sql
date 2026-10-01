ALTER TABLE "exam_schedules" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD COLUMN "previous_exam_date" date;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD COLUMN "change_note" text;--> statement-breakpoint
ALTER TABLE "exam_schedules" ADD COLUMN "cancelled_reason" text;