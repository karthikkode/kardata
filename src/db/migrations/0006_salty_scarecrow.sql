ALTER TYPE "public"."run_kind" ADD VALUE 'manual';--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "created_by" text DEFAULT 'owner' NOT NULL;