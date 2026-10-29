-- D-67: ICP statuses get their own names, so "contactable" is free to mean
-- one thing: Apollo gave us a verified email for someone at the company.
UPDATE "company_verdicts" SET "status" = CASE "status"
  WHEN 'contactable' THEN 'icp_accepted'
  WHEN 'watchlist' THEN 'icp_watchlist'
  WHEN 'excluded' THEN 'icp_rejected'
  ELSE "status" END;
--> statement-breakpoint
UPDATE "company_icp_checks" SET "status" = CASE "status"
  WHEN 'contactable' THEN 'icp_accepted'
  WHEN 'watchlist' THEN 'icp_watchlist'
  WHEN 'excluded' THEN 'icp_rejected'
  ELSE "status" END;
--> statement-breakpoint
ALTER TABLE "company_verdicts" ALTER COLUMN "status" SET DEFAULT 'icp_watchlist';
--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('name_verified_public', 'role_verified_public', 'name_verified_apollo', 'role_verified_apollo', 'email_verified_apollo', 'phone_verified_apollo');
--> statement-breakpoint
CREATE TABLE "company_contact_statuses" (
  "company_id" uuid NOT NULL,
  "status" "contact_status" NOT NULL,
  "people" integer DEFAULT 1 NOT NULL,
  "source" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_contact_statuses_company_id_status_pk" PRIMARY KEY("company_id","status")
);
--> statement-breakpoint
ALTER TABLE "company_contact_statuses" ADD CONSTRAINT "company_contact_statuses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
