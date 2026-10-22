DROP INDEX "company_jobs_one_active_idx";--> statement-breakpoint
ALTER TABLE "company_jobs" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
UPDATE "company_jobs" SET "status"='created' WHERE "status"='queued';--> statement-breakpoint
UPDATE "company_jobs" SET "status"='terminated' WHERE "status"='cancelled';--> statement-breakpoint
UPDATE "company_jobs" SET "status"='scheduled' WHERE "status"='running' AND NOT EXISTS (SELECT 1 FROM "research_runs" "r" WHERE "r"."company_job_id"="company_jobs"."id" AND "r"."status" IN ('queued','running'));--> statement-breakpoint
ALTER TABLE "company_jobs" ALTER COLUMN "status" SET DEFAULT 'created';--> statement-breakpoint
CREATE UNIQUE INDEX "company_jobs_one_active_idx" ON "company_jobs" USING btree ("company_id") WHERE "company_jobs"."status" IN ('created', 'scheduled', 'running', 'paused');--> statement-breakpoint
ALTER TABLE "company_jobs" ADD CONSTRAINT "company_jobs_status_check" CHECK (status IN ('created', 'scheduled', 'running', 'paused', 'completed', 'failed', 'terminated'));--> statement-breakpoint
DROP TYPE "public"."company_job_status";