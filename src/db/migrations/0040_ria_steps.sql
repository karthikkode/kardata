-- Stage 5.8 B1: per-firm RIA step state (done / gap / failed; no row = pending).
CREATE TABLE "ria_step_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "sector_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "step" text NOT NULL,
  "status" text NOT NULL,
  "reason" text,
  "input_hash" text,
  "tokens_used" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ria_step_runs" ADD CONSTRAINT "ria_step_runs_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ria_step_runs" ADD CONSTRAINT "ria_step_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ria_step_runs" ADD CONSTRAINT "ria_step_runs_sector_company_step_key" UNIQUE("sector_id","company_id","step");
--> statement-breakpoint
CREATE INDEX "ria_step_runs_sector_step_idx" ON "ria_step_runs" USING btree ("sector_id","step","status");
