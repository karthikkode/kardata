CREATE TYPE "public"."evidence_grade" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TABLE "web_searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"subagent" text,
	"area" text,
	"tool" text NOT NULL,
	"query_or_url" text NOT NULL,
	"results" jsonb NOT NULL,
	"result_count" integer NOT NULL,
	"at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "evidence_grade" "evidence_grade" DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "web_search_id" uuid;--> statement-breakpoint
ALTER TABLE "web_searches" ADD CONSTRAINT "web_searches_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_searches" ADD CONSTRAINT "web_searches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_searches_run_idx" ON "web_searches" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "web_searches_company_idx" ON "web_searches" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_web_search_id_web_searches_id_fk" FOREIGN KEY ("web_search_id") REFERENCES "public"."web_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "sources" SET "evidence_grade" = 'secondary' WHERE "via" IN ('search', 'muse_fetch');
