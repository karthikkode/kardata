CREATE TABLE "sector_preflight_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "bulk_item_status" DEFAULT 'queued' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
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
CREATE TABLE "sector_preflight_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sector_id" uuid,
	"status" "bulk_job_status" DEFAULT 'running' NOT NULL,
	"only_pending" boolean DEFAULT true NOT NULL,
	"max_companies" integer,
	"max_input_tokens" bigint,
	"max_hours" double precision,
	"error_streak" integer DEFAULT 0 NOT NULL,
	"error_class" text,
	"pause_reason" text,
	"started_runs" integer DEFAULT 0 NOT NULL,
	"input_tokens_spent" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sector_preflight_items" ADD CONSTRAINT "sector_preflight_items_job_id_sector_preflight_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sector_preflight_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_preflight_items" ADD CONSTRAINT "sector_preflight_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_preflight_items" ADD CONSTRAINT "sector_preflight_items_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_preflight_jobs" ADD CONSTRAINT "sector_preflight_jobs_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sector_preflight_items_job_company_idx" ON "sector_preflight_items" USING btree ("job_id","company_id");