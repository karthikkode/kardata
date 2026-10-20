CREATE TYPE "public"."bulk_job_scope" AS ENUM('sector', 'shortlist');--> statement-breakpoint
CREATE TABLE "harness_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD COLUMN "scope" "bulk_job_scope";--> statement-breakpoint
UPDATE "bulk_jobs" SET "scope" = CASE WHEN "kind"::text = 'research_shortlist' THEN 'shortlist'::"bulk_job_scope" ELSE 'sector'::"bulk_job_scope" END;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ALTER COLUMN "scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
UPDATE "bulk_jobs" SET "kind" = CASE WHEN "kind" = 'collect_sector' THEN 'collect' ELSE 'research' END;--> statement-breakpoint
DROP TYPE "public"."bulk_job_kind";--> statement-breakpoint
CREATE TYPE "public"."bulk_job_kind" AS ENUM('research', 'collect');--> statement-breakpoint
ALTER TABLE "bulk_jobs" ALTER COLUMN "kind" SET DATA TYPE "public"."bulk_job_kind" USING "kind"::"public"."bulk_job_kind";--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD COLUMN "max_companies" integer;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD COLUMN "max_hours" double precision;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_job_id_bulk_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."bulk_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_jobs" DROP COLUMN "concurrency";--> statement-breakpoint
ALTER TABLE "bulk_jobs" DROP COLUMN "max_runs";