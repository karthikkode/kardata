CREATE TYPE "public"."bulk_item_status" AS ENUM('queued', 'running', 'extracting', 'succeeded', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bulk_job_kind" AS ENUM('research_sector', 'research_shortlist', 'collect_sector');--> statement-breakpoint
CREATE TYPE "public"."bulk_job_status" AS ENUM('running', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "bulk_job_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "bulk_item_status" DEFAULT 'queued' NOT NULL,
	"run_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"error_class" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "bulk_job_kind" NOT NULL,
	"status" "bulk_job_status" DEFAULT 'running' NOT NULL,
	"sector_id" uuid,
	"shortlist_id" uuid,
	"concurrency" integer NOT NULL,
	"max_runs" integer,
	"max_input_tokens" bigint,
	"skip_if_recent_days" integer DEFAULT 14 NOT NULL,
	"prompt_version" text,
	"error_streak" integer DEFAULT 0 NOT NULL,
	"error_class" text,
	"pause_reason" text,
	"started_runs" integer DEFAULT 0 NOT NULL,
	"input_tokens_spent" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_job_id_bulk_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."bulk_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_shortlist_id_shortlists_id_fk" FOREIGN KEY ("shortlist_id") REFERENCES "public"."shortlists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_job_items_job_company_idx" ON "bulk_job_items" USING btree ("job_id","company_id");