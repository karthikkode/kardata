ALTER TABLE "benchmark_fee_jobs" ADD COLUMN "priority_company_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;
