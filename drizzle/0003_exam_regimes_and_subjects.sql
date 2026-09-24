ALTER TYPE "public"."subject" ADD VALUE 'vocational';--> statement-breakpoint
ALTER TYPE "public"."subject" ADD VALUE 'second_language';--> statement-breakpoint
DROP INDEX "course_aliases_global_uq";--> statement-breakpoint
DROP INDEX "course_aliases_source_uq";--> statement-breakpoint
ALTER TABLE "course_aliases" ADD COLUMN "regime_code" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "regimes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "source_subject_label" text;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "source_label" text;--> statement-breakpoint
CREATE UNIQUE INDEX "course_aliases_global_regime_uq" ON "course_aliases" USING btree ("alias","regime_code") WHERE "course_aliases"."source_id" is null and "course_aliases"."regime_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_aliases_source_regime_uq" ON "course_aliases" USING btree ("alias","source_id","regime_code") WHERE "course_aliases"."source_id" is not null and "course_aliases"."regime_code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_aliases_global_uq" ON "course_aliases" USING btree ("alias") WHERE "course_aliases"."source_id" is null and "course_aliases"."regime_code" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_aliases_source_uq" ON "course_aliases" USING btree ("alias","source_id") WHERE "course_aliases"."source_id" is not null and "course_aliases"."regime_code" is null;--> statement-breakpoint
-- 세부과목별 시험 체제 (src/lib/courses.ts 와 동일해야 한다. tests/unit/course-regime.test.ts 가 확인)
-- 직업탐구·제2외국어/한문 course 행은 새 enum 값을 쓰므로 같은 migration transaction 안에서 넣을 수 없다.
-- → syncCourseCatalog (npm run db:seed / npm run ingest:sources / 수집 실행 시) 가 넣는다.
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'speech-and-writing';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'language-and-media';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'probability-and-statistics';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'calculus';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'geometry';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[1]},{"regime":"csat_2028"}]'::jsonb WHERE "id" = 'integrated-social';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'life-and-ethics';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'ethics-and-thought';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'korean-geography';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'world-geography';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'east-asian-history';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'world-history';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'economics';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'politics-and-law';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'social-culture';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[1]},{"regime":"csat_2028"}]'::jsonb WHERE "id" = 'integrated-science';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'physics-1';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'chemistry-1';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'life-science-1';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'earth-science-1';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'physics-2';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'chemistry-2';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'life-science-2';--> statement-breakpoint
UPDATE "courses" SET "regimes" = '[{"regime":"csat_2022","grades":[2,3]}]'::jsonb WHERE "id" = 'earth-science-2';
