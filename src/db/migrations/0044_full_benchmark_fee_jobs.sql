ALTER TABLE "benchmark_fee_jobs" ADD COLUMN "full_run" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "benchmark_fee_job_results" (
  "job_id" uuid NOT NULL REFERENCES "benchmark_fee_jobs"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL,
  "metrics" jsonb NOT NULL,
  PRIMARY KEY ("job_id", "company_id")
);
