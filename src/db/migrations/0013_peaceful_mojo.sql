CREATE TYPE "public"."verification_status" AS ENUM('verified', 'doc_only', 'unverified');--> statement-breakpoint
DROP VIEW "public"."facts_current";--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "verification" "verification_status" DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "verification" "verification_status" DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "thin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "details" jsonb;--> statement-breakpoint
CREATE VIEW "public"."facts_current" AS (select distinct on ("facts"."company_id", "facts"."key", "facts"."qualifiers") "id", "company_id", "run_id", "key", "area", "value_num", "value_text", "value_date", "value_bool", "value_json", "currency", "qualifiers", "as_of", "source_ids", "confidence", "verification", "created_by", "created_at", "supersedes_id" from "facts" order by "facts"."company_id", "facts"."key", "facts"."qualifiers", "facts"."created_at" desc, "facts"."id" desc);--> statement-breakpoint
UPDATE "sources" SET "thin" = true FROM "blobs" WHERE "sources"."blob_sha256" = "blobs"."sha256" AND "sources"."collector" = 'capture' AND "blobs"."size" < 200;