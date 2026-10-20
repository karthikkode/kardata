ALTER TYPE "public"."area" ADD VALUE 'other';--> statement-breakpoint
ALTER TYPE "public"."value_type" ADD VALUE 'json';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "fact_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "record_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "fact_keys" ADD COLUMN "first_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fact_keys" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "record_types" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_company_path_current_idx" ON "documents" USING btree ("company_id","path") WHERE "documents"."is_current" = true;