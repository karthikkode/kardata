CREATE TYPE "public"."registry_status" AS ENUM('approved', 'provisional');--> statement-breakpoint
CREATE TYPE "public"."value_type" AS ENUM('number', 'money', 'percent', 'date', 'bool', 'text', 'url', 'text_list');--> statement-breakpoint
CREATE TABLE "fact_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"area" "area",
	"value_type" "value_type" NOT NULL,
	"unit" text,
	"description" text NOT NULL,
	"qualifier_names" text[] DEFAULT '{}' NOT NULL,
	"status" "registry_status" DEFAULT 'provisional' NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid,
	"key" text NOT NULL,
	"area" "area",
	"value_num" numeric,
	"value_text" text,
	"value_date" date,
	"value_bool" boolean,
	"value_json" jsonb,
	"currency" text,
	"qualifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"as_of" date,
	"source_ids" uuid[] NOT NULL,
	"confidence" "confidence" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_id" uuid,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "key"), 'A') || to_tsvector('english', coalesce("value_text", ''))) STORED,
	CONSTRAINT "facts_source_ids_not_empty" CHECK (cardinality("facts"."source_ids") > 0)
);
--> statement-breakpoint
CREATE TABLE "record_types" (
	"name" text PRIMARY KEY NOT NULL,
	"area" "area",
	"description" text NOT NULL,
	"fields" jsonb NOT NULL,
	"natural_key" text[] NOT NULL,
	"status" "registry_status" DEFAULT 'provisional' NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"area" "area",
	"natural_key_hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"source_ids" uuid[] NOT NULL,
	"first_seen_run_id" uuid,
	"last_seen_run_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (jsonb_to_tsvector('english', "data", '["string"]')) STORED,
	CONSTRAINT "records_source_ids_not_empty" CHECK (cardinality("records"."source_ids") > 0)
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "fact_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "record_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "url" || ' ' || coalesce("error", ''))) STORED;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_key_fact_keys_key_fk" FOREIGN KEY ("key") REFERENCES "public"."fact_keys"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_supersedes_id_facts_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_type_record_types_name_fk" FOREIGN KEY ("type") REFERENCES "public"."record_types"("name") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_first_seen_run_id_research_runs_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_last_seen_run_id_research_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."research_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facts_company_key_idx" ON "facts" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "facts_qualifiers_idx" ON "facts" USING gin ("qualifiers");--> statement-breakpoint
CREATE INDEX "facts_tsv_idx" ON "facts" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "records_company_type_hash_idx" ON "records" USING btree ("company_id","type","natural_key_hash");--> statement-breakpoint
CREATE INDEX "records_data_idx" ON "records" USING gin ("data");--> statement-breakpoint
CREATE INDEX "records_tsv_idx" ON "records" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "sources_tsv_idx" ON "sources" USING gin ("tsv");--> statement-breakpoint
CREATE VIEW "public"."facts_current" AS (select distinct on ("facts"."company_id", "facts"."key", "facts"."qualifiers") "id", "company_id", "run_id", "key", "area", "value_num", "value_text", "value_date", "value_bool", "value_json", "currency", "qualifiers", "as_of", "source_ids", "confidence", "created_by", "created_at", "supersedes_id" from "facts" order by "facts"."company_id", "facts"."key", "facts"."qualifiers", "facts"."created_at" desc, "facts"."id" desc);--> statement-breakpoint
INSERT INTO "fact_keys" ("key", "area", "value_type", "unit", "description", "qualifier_names", "status", "created_by") VALUES
('product.count', 'product', 'number', NULL, 'Products in the catalog', '{}', 'approved', 'seed'),
('product.price_min', 'product', 'money', NULL, 'Lowest variant price in the catalog', '{}', 'approved', 'seed'),
('product.price_median', 'product', 'money', NULL, 'Median variant price in the catalog', '{}', 'approved', 'seed'),
('product.price_max', 'product', 'money', NULL, 'Highest variant price in the catalog', '{}', 'approved', 'seed'),
('product.launches_per_month', 'product', 'number', NULL, 'Products launched in a month', '{month}', 'approved', 'seed'),
('product.type_count', 'product', 'number', NULL, 'Products of one product type', '{type}', 'approved', 'seed'),
('product.catalog_change_12m', 'product', 'percent', NULL, 'Catalog size change vs 12 months ago, in percent', '{}', 'approved', 'seed'),
('reviews.avg_rating', 'reviews', 'number', NULL, 'Average rating', '{platform}', 'approved', 'seed'),
('reviews.count', 'reviews', 'number', NULL, 'Number of ratings', '{platform}', 'approved', 'seed'),
('reviews.app', 'reviews', 'text', NULL, 'Review app used on the site', '{}', 'approved', 'seed'),
('marketing.channel_active', 'marketing', 'bool', NULL, 'Whether a marketing channel is active', '{channel}', 'approved', 'seed'),
('marketing.tool', 'marketing', 'text', NULL, 'Marketing tool in use', '{category}', 'approved', 'seed'),
('marketing.positioning', 'marketing', 'text', NULL, 'Positioning statement', '{}', 'approved', 'seed'),
('business_model.subscription', 'business_model', 'bool', NULL, 'Sells subscriptions', '{}', 'approved', 'seed'),
('business_model.wholesale', 'business_model', 'bool', NULL, 'Sells wholesale', '{}', 'approved', 'seed'),
('business_model.marketplace', 'business_model', 'bool', NULL, 'Sells on a marketplace', '{marketplace}', 'approved', 'seed'),
('business_model.bnpl', 'business_model', 'bool', NULL, 'Offers buy-now-pay-later', '{}', 'approved', 'seed'),
('business_model.retail_presence', 'business_model', 'bool', NULL, 'Sold in physical retail', '{}', 'approved', 'seed'),
('business_model.price_tier', 'business_model', 'text', NULL, 'Price tier: budget, mid, premium or luxury', '{}', 'approved', 'seed'),
('hiring.open_roles', 'hiring', 'number', NULL, 'Open roles', '{}', 'approved', 'seed'),
('hiring.open_roles_by_department', 'hiring', 'number', NULL, 'Open roles in one department', '{department}', 'approved', 'seed'),
('hiring.board', 'hiring', 'text', NULL, 'Job board provider', '{}', 'approved', 'seed'),
('financials.revenue_estimate', 'financials', 'money', NULL, 'Estimated annual revenue', '{source}', 'approved', 'seed'),
('financials.total_funding', 'financials', 'money', NULL, 'Total funding raised', '{}', 'approved', 'seed'),
('financials.employees', 'financials', 'number', NULL, 'Employee count', '{source}', 'approved', 'seed'),
('financials.accounts_type', 'financials', 'text', NULL, 'Latest accounts type', '{}', 'approved', 'seed'),
('financials.last_raise_date', 'financials', 'date', NULL, 'Date of the latest fundraise', '{}', 'approved', 'seed'),
('company.founded_year', NULL, 'number', NULL, 'Year founded', '{}', 'approved', 'seed'),
('company.hq_country', NULL, 'text', NULL, 'Headquarters country', '{}', 'approved', 'seed');
--> statement-breakpoint
INSERT INTO "record_types" ("name", "area", "description", "fields", "natural_key", "status", "created_by") VALUES
('product', 'product', 'One product in the catalog', '[{"name": "name", "type": "text", "required": true, "description": "Product name"}, {"name": "url", "type": "url", "required": true, "description": "Product page URL"}, {"name": "price", "type": "number", "required": false, "description": "Price (lowest variant when several)"}, {"name": "currency", "type": "text", "required": false, "description": "ISO currency code"}, {"name": "product_type", "type": "text", "required": false, "description": "Product type"}, {"name": "launched_at", "type": "date", "required": false, "description": "Launch date"}, {"name": "tags", "type": "text_list", "required": false, "description": "Product tags"}]'::jsonb, '{url}', 'approved', 'seed'),
('job_posting', 'hiring', 'One open job posting', '[{"name": "title", "type": "text", "required": true, "description": "Job title"}, {"name": "department", "type": "text", "required": false, "description": "Department"}, {"name": "location", "type": "text", "required": false, "description": "Location"}, {"name": "posted_at", "type": "date", "required": false, "description": "Posting date, when shown"}, {"name": "url", "type": "url", "required": true, "description": "Posting URL"}, {"name": "comp_min", "type": "number", "required": false, "description": "Compensation range minimum"}, {"name": "comp_max", "type": "number", "required": false, "description": "Compensation range maximum"}, {"name": "currency", "type": "text", "required": false, "description": "ISO currency code"}]'::jsonb, '{url}', 'approved', 'seed'),
('review_excerpt', 'reviews', 'One quoted review', '[{"name": "platform", "type": "text", "required": true, "description": "Review platform"}, {"name": "rating", "type": "number", "required": false, "description": "Star rating"}, {"name": "text", "type": "long_text", "required": true, "description": "Review text quoted as-is"}, {"name": "date", "type": "date", "required": false, "description": "Review date"}, {"name": "url", "type": "url", "required": true, "description": "Review URL"}]'::jsonb, '{url,text_hash}', 'approved', 'seed'),
('review_theme', 'reviews', 'One recurring review theme', '[{"name": "theme", "type": "text", "required": true, "description": "Theme name"}, {"name": "sentiment", "type": "text", "required": true, "description": "positive or negative"}, {"name": "prevalence", "type": "text", "required": false, "description": "low, medium or high"}, {"name": "example_record_ids", "type": "text_list", "required": false, "description": "Example review_excerpt record ids"}]'::jsonb, '{theme,sentiment}', 'approved', 'seed'),
('news_item', 'decisions', 'One press mention', '[{"name": "title", "type": "text", "required": true, "description": "Article title"}, {"name": "outlet", "type": "text", "required": false, "description": "Outlet name"}, {"name": "url", "type": "url", "required": true, "description": "Article URL"}, {"name": "published_at", "type": "date", "required": false, "description": "Publication date"}, {"name": "summary", "type": "long_text", "required": false, "description": "Summary"}, {"name": "verified", "type": "bool", "required": false, "description": "True once Stage 3 verifies the mention"}]'::jsonb, '{url}', 'approved', 'seed'),
('funding_event', 'financials', 'One funding event', '[{"name": "date", "type": "date", "required": true, "description": "Event date"}, {"name": "amount", "type": "number", "required": false, "description": "Amount raised"}, {"name": "currency", "type": "text", "required": false, "description": "ISO currency code"}, {"name": "round", "type": "text", "required": true, "description": "Round name, e.g. Seed, Series A"}, {"name": "investors", "type": "text_list", "required": false, "description": "Investor names"}, {"name": "filing_url", "type": "url", "required": false, "description": "Filing URL"}]'::jsonb, '{date,round}', 'approved', 'seed'),
('company_event', 'decisions', 'One dated company event', '[{"name": "date", "type": "date", "required": true, "description": "Event date"}, {"name": "event_type", "type": "text", "required": true, "description": "launch, expansion, leadership_change, pricing_change, rebrand, partnership, closure or other"}, {"name": "summary", "type": "long_text", "required": true, "description": "Event summary"}]'::jsonb, '{date,event_type,summary}', 'approved', 'seed'),
('retailer', 'business_model', 'One stockist or sales channel', '[{"name": "name", "type": "text", "required": true, "description": "Retailer name"}, {"name": "kind", "type": "text", "required": false, "description": "retail, marketplace, wholesale or pharmacy"}, {"name": "url", "type": "url", "required": false, "description": "Retailer URL"}, {"name": "country", "type": "text", "required": false, "description": "Country"}]'::jsonb, '{name}', 'approved', 'seed'),
('competitor', 'decisions', 'One competitor', '[{"name": "name", "type": "text", "required": false, "description": "Competitor name"}, {"name": "domain", "type": "text", "required": true, "description": "Competitor domain"}, {"name": "reason", "type": "text", "required": false, "description": "Why it counts as a competitor"}]'::jsonb, '{domain}', 'approved', 'seed'),
('leader', 'business_model', 'One public business leader (roles only, nothing personal)', '[{"name": "name", "type": "text", "required": true, "description": "Leader name"}, {"name": "title", "type": "text", "required": true, "description": "Business title"}, {"name": "since", "type": "date", "required": false, "description": "In role since"}]'::jsonb, '{name,title}', 'approved', 'seed'),
('blog_post', 'decisions', 'One company blog post', '[{"name": "title", "type": "text", "required": false, "description": "Post title"}, {"name": "url", "type": "url", "required": true, "description": "Post URL"}, {"name": "published_at", "type": "date", "required": false, "description": "Publication date"}, {"name": "summary", "type": "long_text", "required": false, "description": "Summary"}]'::jsonb, '{url}', 'approved', 'seed');
