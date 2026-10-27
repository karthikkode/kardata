-- Stage 5.6 B5: a company job knows its sector, so research prompts can
-- carry that sector's profile hints. Detached jobs keep no sector.
ALTER TABLE "company_jobs" ADD COLUMN "sector_id" uuid;
--> statement-breakpoint
ALTER TABLE "company_jobs" ADD CONSTRAINT "company_jobs_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE set null ON UPDATE no action;
