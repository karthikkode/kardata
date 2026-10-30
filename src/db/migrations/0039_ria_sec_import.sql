-- Stage 5.7 B2: SEC adviser import keys companies by CRD number.
ALTER TYPE "public"."company_source" ADD VALUE 'sec';
--> statement-breakpoint
ALTER TYPE "public"."membership_added_via" ADD VALUE 'sec';
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sec_crd" text;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_sec_crd_key" UNIQUE("sec_crd");
