ALTER TYPE "run_kind" ADD VALUE IF NOT EXISTS 'icp';--> statement-breakpoint
ALTER TYPE "company_job_stage" ADD VALUE IF NOT EXISTS 'icp';--> statement-breakpoint
ALTER TABLE "sector_preflight_jobs" ADD COLUMN "kind" text DEFAULT 'preflight' NOT NULL;--> statement-breakpoint
CREATE TABLE "company_icp_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"sector_id" uuid NOT NULL,
	"run_id" uuid,
	"prompt_version" text NOT NULL,
	"pack_hash" text NOT NULL,
	"score" integer NOT NULL,
	"status" text NOT NULL,
	"exclusion_reason" text,
	"results" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "company_icp_checks" ADD CONSTRAINT "company_icp_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_icp_checks" ADD CONSTRAINT "company_icp_checks_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_icp_checks" ADD CONSTRAINT "company_icp_checks_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_icp_checks_company_idx" ON "company_icp_checks" USING btree ("company_id","created_at");
