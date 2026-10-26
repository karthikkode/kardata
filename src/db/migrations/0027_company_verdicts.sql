CREATE TABLE "company_verdicts" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"sector_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"signals" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'watchlist' NOT NULL,
	"exclusion_reason" text,
	"source" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_verdicts" ADD CONSTRAINT "company_verdicts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_verdicts" ADD CONSTRAINT "company_verdicts_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;
