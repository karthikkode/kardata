CREATE TABLE "shortlists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sector_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company_ids" uuid[] NOT NULL,
	"criteria" jsonb,
	"created_by" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shortlists_sector_name_idx" ON "shortlists" USING btree ("sector_id","name");