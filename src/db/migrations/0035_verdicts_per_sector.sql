-- Stage 5.6 B4: verdicts are per sector. A company researched in two
-- sectors keeps one verdict per sector; existing rows keep their sector.
ALTER TABLE "company_verdicts" DROP CONSTRAINT "company_verdicts_pkey";
--> statement-breakpoint
ALTER TABLE "company_verdicts" ADD PRIMARY KEY ("company_id", "sector_id");
