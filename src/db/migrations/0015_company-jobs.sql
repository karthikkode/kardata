CREATE TYPE "public"."company_job_stage" AS ENUM('preflight', 'collect', 'research', 'extraction');--> statement-breakpoint
CREATE TYPE "public"."company_job_status" AS ENUM('queued', 'running', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "company_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "company_job_status" DEFAULT 'queued' NOT NULL,
	"current_stage" "company_job_stage",
	"error_class" text,
	"pause_reason" text,
	"max_input_tokens" bigint,
	"max_hours" double precision,
	"input_tokens_spent" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "http_fetches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_job_id" uuid,
	"run_id" uuid,
	"company_id" uuid NOT NULL,
	"collector" text NOT NULL,
	"url" text NOT NULL,
	"host" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"status_code" integer,
	"bytes" integer,
	"duration_ms" integer,
	"cached" boolean DEFAULT false NOT NULL,
	"area" text,
	"source_id" uuid,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"stage" "company_job_stage",
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preflight_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"report_version" integer DEFAULT 1 NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_job_id" uuid,
	"run_id" uuid,
	"stage" "company_job_stage" NOT NULL,
	"usage_id" text,
	"session_id" text,
	"child_session_id" text,
	"seq" integer DEFAULT 0 NOT NULL,
	"response_id" text,
	"model" text,
	"provider" text,
	"prompt_sha256" text,
	"response_sha256" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"duration_ms" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "company_job_id" uuid;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "stage" "company_job_stage";--> statement-breakpoint
ALTER TABLE "company_jobs" ADD CONSTRAINT "company_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_fetches" ADD CONSTRAINT "http_fetches_company_job_id_company_jobs_id_fk" FOREIGN KEY ("company_job_id") REFERENCES "public"."company_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_fetches" ADD CONSTRAINT "http_fetches_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_fetches" ADD CONSTRAINT "http_fetches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_fetches" ADD CONSTRAINT "http_fetches_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_company_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."company_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preflight_reports" ADD CONSTRAINT "preflight_reports_job_id_company_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."company_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preflight_reports" ADD CONSTRAINT "preflight_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_company_job_id_company_jobs_id_fk" FOREIGN KEY ("company_job_id") REFERENCES "public"."company_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_prompt_sha256_blobs_sha256_fk" FOREIGN KEY ("prompt_sha256") REFERENCES "public"."blobs"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_response_sha256_blobs_sha256_fk" FOREIGN KEY ("response_sha256") REFERENCES "public"."blobs"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_jobs_one_active_idx" ON "company_jobs" USING btree ("company_id") WHERE "company_jobs"."status" IN ('queued', 'running', 'paused');--> statement-breakpoint
CREATE INDEX "http_fetches_job_idx" ON "http_fetches" USING btree ("company_job_id","id");--> statement-breakpoint
CREATE INDEX "http_fetches_run_idx" ON "http_fetches" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "preflight_reports_job_version_idx" ON "preflight_reports" USING btree ("job_id","report_version");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_calls_usage_idx" ON "provider_calls" USING btree ("usage_id") WHERE "provider_calls"."usage_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_calls_job_idx" ON "provider_calls" USING btree ("company_job_id","id");--> statement-breakpoint
CREATE INDEX "provider_calls_run_idx" ON "provider_calls" USING btree ("run_id","id");--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_company_job_id_company_jobs_id_fk" FOREIGN KEY ("company_job_id") REFERENCES "public"."company_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_runs_company_job_idx" ON "research_runs" USING btree ("company_job_id","id");