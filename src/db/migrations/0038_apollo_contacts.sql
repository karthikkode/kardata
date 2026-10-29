-- D-67: people the owner paid Apollo for, kept so they are never bought twice.
-- The Apollo contact statuses are derived from these rows.
CREATE TABLE "apollo_contacts" (
  "apollo_id" text PRIMARY KEY NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text,
  "title" text,
  "email" text,
  "email_status" text,
  "mobile" text,
  "linkedin" text,
  "source" text NOT NULL,
  "pulled_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apollo_contacts" ADD CONSTRAINT "apollo_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "apollo_contacts_company_idx" ON "apollo_contacts" USING btree ("company_id");
