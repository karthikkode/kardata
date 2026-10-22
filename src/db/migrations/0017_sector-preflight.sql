ALTER TYPE "public"."company_job_stage" ADD VALUE 'sector_preflight';--> statement-breakpoint
ALTER TYPE "public"."run_kind" ADD VALUE 'sector_preflight';--> statement-breakpoint
CREATE TABLE "sector_preflight" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sector_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid,
	"business_type" text NOT NULL,
	"primary_category" text NOT NULL,
	"sells_own_products" boolean NOT NULL,
	"has_online_store" boolean NOT NULL,
	"ships_to" text[] DEFAULT '{}' NOT NULL,
	"confidence" "confidence" NOT NULL,
	"reason" text NOT NULL,
	"quote" text,
	"quote_source_id" uuid,
	"verification" "verification_status" DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sector_preflight" ADD CONSTRAINT "sector_preflight_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_preflight" ADD CONSTRAINT "sector_preflight_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_preflight" ADD CONSTRAINT "sector_preflight_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sector_preflight_sector_company_idx" ON "sector_preflight" USING btree ("sector_id","company_id");