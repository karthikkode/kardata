CREATE TABLE "benchmark_fee_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "sector_id" uuid NOT NULL REFERENCES "sectors"("id") ON DELETE CASCADE,
  "company_ids" uuid[] NOT NULL,
  "eligible_selected" integer NOT NULL,
  "cohort_size" integer NOT NULL,
  "concurrency" integer NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "reason" text,
  "results" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "elapsed_ms" bigint DEFAULT 0 NOT NULL,
  "active_since" timestamptz,
  "lease_id" uuid,
  "lease_until" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "benchmark_fee_jobs_status_created_idx" ON "benchmark_fee_jobs" ("status", "created_at");
