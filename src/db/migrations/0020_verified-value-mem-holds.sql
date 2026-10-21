ALTER TYPE "public"."verification_status" ADD VALUE 'verified_value';--> statement-breakpoint
ALTER TABLE "sector_preflight_jobs" ADD COLUMN "mem_holds" integer DEFAULT 0 NOT NULL;