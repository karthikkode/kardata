CREATE TYPE "public"."eligibility_decision" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."eligibility_source" AS ENUM('rule', 'override');--> statement-breakpoint
CREATE TYPE "public"."sector_eligibility" AS ENUM('pending', 'eligible', 'review', 'ineligible');--> statement-breakpoint
CREATE TABLE "sector_eligibility_overrides" (
	"sector_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"decision" "eligibility_decision" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_eligibility_overrides_sector_id_company_id_pk" PRIMARY KEY("sector_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "sector_companies" ADD COLUMN "eligibility" "sector_eligibility" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "sector_companies" ADD COLUMN "eligibility_source" "eligibility_source";--> statement-breakpoint
ALTER TABLE "sector_companies" ADD COLUMN "eligibility_reason" text;--> statement-breakpoint
ALTER TABLE "sectors" ADD COLUMN "eligibility_rules" jsonb;--> statement-breakpoint
ALTER TABLE "sector_eligibility_overrides" ADD CONSTRAINT "sector_eligibility_overrides_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_eligibility_overrides" ADD CONSTRAINT "sector_eligibility_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;