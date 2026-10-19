CREATE TYPE "public"."company_source" AS ENUM('apollo', 'manual');--> statement-breakpoint
CREATE TYPE "public"."membership_added_via" AS ENUM('csv', 'manual');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"apollo_account_id" text,
	"source" "company_source" NOT NULL,
	"domain" text,
	"shared_domain" boolean DEFAULT false NOT NULL,
	"name" text,
	"website" text,
	"linkedin_url" text,
	"facebook_url" text,
	"twitter_url" text,
	"employees" integer,
	"industry" text,
	"keywords" text[],
	"technologies" text[],
	"country" text,
	"state" text,
	"city" text,
	"postal_code" text,
	"address" text,
	"phone" text,
	"annual_revenue" numeric,
	"total_funding" numeric,
	"latest_funding" text,
	"latest_funding_amount" numeric,
	"last_raised_at" date,
	"founded_year" integer,
	"short_description" text,
	"logo_url" text,
	"sic_codes" text[],
	"naics_codes" text[],
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_apollo_account_id_key" UNIQUE("apollo_account_id")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sector_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"linked_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sector_companies" (
	"sector_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"added_via" "membership_added_via" NOT NULL,
	"first_import_id" uuid,
	"last_import_id" uuid,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_companies_sector_id_company_id_pk" PRIMARY KEY("sector_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_companies" ADD CONSTRAINT "sector_companies_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_companies" ADD CONSTRAINT "sector_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_domain_idx" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "companies_technologies_idx" ON "companies" USING gin ("technologies");--> statement-breakpoint
CREATE INDEX "companies_keywords_idx" ON "companies" USING gin ("keywords");--> statement-breakpoint
CREATE INDEX "companies_country_idx" ON "companies" USING btree ("country");--> statement-breakpoint
CREATE INDEX "companies_employees_idx" ON "companies" USING btree ("employees");--> statement-breakpoint
CREATE INDEX "companies_industry_idx" ON "companies" USING btree ("industry");--> statement-breakpoint
CREATE UNIQUE INDEX "sectors_name_lower_idx" ON "sectors" USING btree (lower("name"));