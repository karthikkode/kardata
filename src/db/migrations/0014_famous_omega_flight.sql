ALTER TYPE "public"."verification_status" ADD VALUE 'quote_mismatch';--> statement-breakpoint
DROP VIEW "public"."facts_current";--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "quote_source_id" uuid;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "verification" "verification_status" DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "quote_source_id" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "quote_source_id" uuid;--> statement-breakpoint
CREATE VIEW "public"."facts_current" AS (select distinct on ("facts"."company_id", "facts"."key", "facts"."qualifiers") "id", "company_id", "run_id", "key", "area", "value_num", "value_text", "value_date", "value_bool", "value_json", "currency", "qualifiers", "as_of", "source_ids", "confidence", "verification", "quote", "quote_source_id", "created_by", "created_at", "supersedes_id" from "facts" order by "facts"."company_id", "facts"."key", "facts"."qualifiers", "facts"."created_at" desc, "facts"."id" desc);