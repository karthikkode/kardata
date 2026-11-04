ALTER TABLE "sectors" ADD COLUMN "evidence_library" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "evidence_library" boolean DEFAULT false NOT NULL;
