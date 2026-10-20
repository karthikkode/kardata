CREATE TYPE "public"."area" AS ENUM('reviews', 'marketing', 'financials', 'business_model', 'hiring', 'product', 'decisions');--> statement-breakpoint
CREATE TYPE "public"."area_status" AS ENUM('done', 'not_found', 'blocked', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('extract', 'summary', 'agent_note', 'report', 'artifact');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('supported', 'conflicting', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('collect', 'agent');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'stalled');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('ok', 'not_found', 'blocked', 'robots_disallowed', 'error');--> statement-breakpoint
CREATE TABLE "area_statuses" (
	"run_id" uuid NOT NULL,
	"area" "area" NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "area_status" NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_statuses_run_id_area_pk" PRIMARY KEY("run_id","area"),
	CONSTRAINT "area_statuses_reason_required" CHECK ("area_statuses"."status" = 'done' OR "area_statuses"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "blobs" (
	"sha256" text PRIMARY KEY NOT NULL,
	"content_type" text,
	"size" integer NOT NULL,
	"gzip" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid,
	"area" "area",
	"kind" "document_kind" NOT NULL,
	"title" text NOT NULL,
	"content_md" text NOT NULL,
	"source_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_by" text NOT NULL,
	"content_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "title"), 'A') || to_tsvector('english', "content_md")) STORED
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid,
	"area" "area" NOT NULL,
	"claim" text NOT NULL,
	"detail" text,
	"source_ids" uuid[] NOT NULL,
	"confidence" "confidence" NOT NULL,
	"status" "finding_status" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_source_ids_not_empty" CHECK (cardinality("findings"."source_ids") > 0)
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "run_kind" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"requested_areas" "area"[],
	"batch_id" uuid,
	"error" text,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"url" text NOT NULL,
	"final_url" text NOT NULL,
	"collector" text NOT NULL,
	"status" "source_status" NOT NULL,
	"http_status" integer,
	"error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blob_sha256" text
);
--> statement-breakpoint
ALTER TABLE "area_statuses" ADD CONSTRAINT "area_statuses_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area_statuses" ADD CONSTRAINT "area_statuses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_blob_sha256_blobs_sha256_fk" FOREIGN KEY ("blob_sha256") REFERENCES "public"."blobs"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_company_idx" ON "documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "documents_tsv_idx" ON "documents" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "findings_company_idx" ON "findings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_runs_one_active_idx" ON "research_runs" USING btree ("company_id") WHERE "research_runs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "sources_run_idx" ON "sources" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sources_company_idx" ON "sources" USING btree ("company_id");