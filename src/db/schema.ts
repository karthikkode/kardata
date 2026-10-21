import { desc, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const companySource = pgEnum("company_source", ["apollo", "manual"]);
export const membershipAddedVia = pgEnum("membership_added_via", ["csv", "manual"]);

export const sectors = pgTable(
  "sectors",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("sectors_name_lower_idx").on(sql`lower(${t.name})`)],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey(),
    // Plain UNIQUE on a nullable column: Postgres treats NULLs as distinct,
    // which is exactly "unique where not null".
    apolloAccountId: text("apollo_account_id").unique("companies_apollo_account_id_key"),
    source: companySource("source").notNull(),
    domain: text("domain"),
    sharedDomain: boolean("shared_domain").notNull().default(false),
    name: text("name"),
    website: text("website"),
    linkedinUrl: text("linkedin_url"),
    facebookUrl: text("facebook_url"),
    twitterUrl: text("twitter_url"),
    employees: integer("employees"),
    industry: text("industry"),
    keywords: text("keywords").array(),
    technologies: text("technologies").array(),
    country: text("country"),
    state: text("state"),
    city: text("city"),
    postalCode: text("postal_code"),
    address: text("address"),
    phone: text("phone"),
    annualRevenue: numeric("annual_revenue"),
    totalFunding: numeric("total_funding"),
    latestFunding: text("latest_funding"),
    latestFundingAmount: numeric("latest_funding_amount"),
    lastRaisedAt: date("last_raised_at"),
    foundedYear: integer("founded_year"),
    shortDescription: text("short_description"),
    logoUrl: text("logo_url"),
    sicCodes: text("sic_codes").array(),
    naicsCodes: text("naics_codes").array(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    overrides: jsonb("overrides").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("companies_domain_idx").on(t.domain),
    index("companies_technologies_idx").using("gin", t.technologies),
    index("companies_keywords_idx").using("gin", t.keywords),
    index("companies_country_idx").on(t.country),
    index("companies_employees_idx").on(t.employees),
    index("companies_industry_idx").on(t.industry),
  ],
);

export const sectorCompanies = pgTable(
  "sector_companies",
  {
    sectorId: uuid("sector_id")
      .notNull()
      .references(() => sectors.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    addedVia: membershipAddedVia("added_via").notNull(),
    firstImportId: uuid("first_import_id"),
    lastImportId: uuid("last_import_id"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sectorId, t.companyId] })],
);

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey(),
  sectorId: uuid("sector_id")
    .notNull()
    .references(() => sectors.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  fileSha256: text("file_sha256").notNull(),
  rowsRead: integer("rows_read").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  linkedCount: integer("linked_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  skipped: jsonb("skipped").$type<{ row: number; reason: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Sector = typeof sectors.$inferSelect;
export type NewSector = typeof sectors.$inferInsert;
export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type SectorCompany = typeof sectorCompanies.$inferSelect;
export type Import = typeof imports.$inferSelect;

// ---- Stage 4 Step 0: saved screening shortlists (one name per sector) ----

export const shortlists = pgTable(
  "shortlists",
  {
    id: uuid("id").primaryKey(),
    sectorId: uuid("sector_id")
      .notNull()
      .references(() => sectors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    companyIds: uuid("company_ids").array().notNull(),
    criteria: jsonb("criteria").$type<unknown[] | null>(),
    createdBy: text("created_by").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shortlists_sector_name_idx").on(t.sectorId, t.name)],
);

export type Shortlist = typeof shortlists.$inferSelect;

// ---- Stage 2: research store ----

export const area = pgEnum("area", [
  "reviews",
  "marketing",
  "financials",
  "business_model",
  "hiring",
  "product",
  "decisions",
  "other",
]);
export type Area = (typeof area.enumValues)[number];

export const runKind = pgEnum("run_kind", ["collect", "agent", "manual", "sector_preflight"]);
export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "stalled",
]);
export const companyJobStatus = pgEnum("company_job_status", [
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export const companyJobStage = pgEnum("company_job_stage", [
  "preflight",
  "collect",
  "research",
  "extraction",
  // Pipeline-stage vocabulary shared by runs and provider_calls; sector
  // preflight is not a company stage but is logged like one.
  "sector_preflight",
]);
export const sourceStatus = pgEnum("source_status", [
  "ok",
  "not_found",
  "blocked",
  "robots_disallowed",
  "error",
]);
export const documentKind = pgEnum("document_kind", [
  "extract",
  "summary",
  "agent_note",
  "report",
  "artifact",
]);
export const confidence = pgEnum("confidence", ["low", "medium", "high"]);
export const verificationStatus = pgEnum("verification_status", ["verified", "doc_only", "unverified", "quote_mismatch"]);
export const findingStatus = pgEnum("finding_status", ["supported", "conflicting", "unverified"]);
export const areaStatus = pgEnum("area_status", ["done", "not_found", "blocked", "error", "skipped"]);

// ---- Stage 2b: research data model (registry, facts, records) ----

export const valueType = pgEnum("value_type", [
  "number",
  "money",
  "percent",
  "date",
  "bool",
  "text",
  "url",
  "text_list",
  "json",
]);
export type ValueType = (typeof valueType.enumValues)[number];

export const registryStatus = pgEnum("registry_status", ["approved", "provisional"]);
export type RegistryStatus = (typeof registryStatus.enumValues)[number];

export const factKeys = pgTable("fact_keys", {
  key: text("key").primaryKey(),
  // Null area = general (company.* keys).
  area: area("area"),
  valueType: valueType("value_type").notNull(),
  unit: text("unit"),
  description: text("description").notNull(),
  qualifierNames: text("qualifier_names").array().notNull().default([]),
  status: registryStatus("status").notNull().default("provisional"),
  createdBy: text("created_by").notNull(),
  firstUsedAt: timestamp("first_used_at", { withTimezone: true }),
  useCount: integer("use_count").notNull().default(0),
});

export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "set null" }),
    key: text("key")
      .notNull()
      .references(() => factKeys.key, { onUpdate: "cascade" }),
    area: area("area"),
    valueNum: numeric("value_num"),
    valueText: text("value_text"),
    valueDate: date("value_date"),
    valueBool: boolean("value_bool"),
    valueJson: jsonb("value_json").$type<unknown>(),
    currency: text("currency"),
    unit: text("unit"),
    qualifiers: jsonb("qualifiers").$type<Record<string, string>>().notNull().default({}),
    asOf: date("as_of"),
    sourceIds: uuid("source_ids").array().notNull(),
    confidence: confidence("confidence").notNull(),
    verification: verificationStatus("verification").notNull().default("unverified"),
    quote: text("quote"),
    quoteSourceId: uuid("quote_source_id"),
    note: text("note"),
    tags: text("tags").array().notNull().default([]),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => facts.id, {
      onDelete: "set null",
    }),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', "key"), 'A') || to_tsvector('english', coalesce("value_text", ''))`,
    ),
  },
  (t) => [
    check("facts_source_ids_not_empty", sql`cardinality(${t.sourceIds}) > 0`),
    index("facts_company_key_idx").on(t.companyId, t.key),
    index("facts_qualifiers_idx").using("gin", t.qualifiers),
    index("facts_tsv_idx").using("gin", t.tsv),
  ],
);

export const recordTypes = pgTable("record_types", {
  name: text("name").primaryKey(),
  area: area("area"),
  description: text("description").notNull(),
  fields: jsonb("fields").$type<RecordField[]>().notNull(),
  naturalKey: text("natural_key").array().notNull(),
  status: registryStatus("status").notNull().default("provisional"),
  createdBy: text("created_by").notNull(),
  useCount: integer("use_count").notNull().default(0),
});

export interface RecordField {
  name: string;
  type: string;
  description: string;
}

export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type")
      .notNull()
      .references(() => recordTypes.name, { onUpdate: "cascade" }),
    area: area("area"),
    naturalKeyHash: text("natural_key_hash").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    sourceIds: uuid("source_ids").array().notNull(),
    verification: verificationStatus("verification").notNull().default("unverified"),
    quote: text("quote"),
    quoteSourceId: uuid("quote_source_id"),
    tags: text("tags").array().notNull().default([]),
    firstSeenRunId: uuid("first_seen_run_id").references(() => researchRuns.id, {
      onDelete: "set null",
    }),
    lastSeenRunId: uuid("last_seen_run_id").references(() => researchRuns.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`jsonb_to_tsvector('english', "data", '["string"]')`,
    ),
  },
  (t) => [
    check("records_source_ids_not_empty", sql`cardinality(${t.sourceIds}) > 0`),
    uniqueIndex("records_company_type_hash_idx").on(t.companyId, t.type, t.naturalKeyHash),
    index("records_data_idx").using("gin", t.data),
    index("records_tsv_idx").using("gin", t.tsv),
  ],
);

export interface AgentOptions {
  recollectDays: number;
  maxMinutes: number;
  maxModelSteps: number;
  brief?: string;
}

export interface ChildUsage {
  sessionId: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  calls: number;
}

export interface AgentUsage {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  calls: number;
  childrenIncluded: boolean;
  children?: ChildUsage[];
  note?: string;
}

export const researchRuns = pgTable(
  "research_runs",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: runKind("kind").notNull(),
    status: runStatus("status").notNull().default("queued"),
    createdBy: text("created_by").notNull().default("owner"),
    requestedAreas: area("requested_areas").array(),
    batchId: uuid("batch_id"),
    jobId: uuid("job_id").references(() => bulkJobs.id, { onDelete: "set null" }),
    // Stage 5: subjob of a company job. Null = legacy / operator run.
    companyJobId: uuid("company_job_id").references(() => companyJobs.id, { onDelete: "set null" }),
    stage: companyJobStage("stage"),
    error: text("error"),
    // Agent runs only (Stage 3b Step 2): phase while running, the options
    // research_start was called with, and the researching outcome.
    // promptVersion is null for pre-v1 runs (rendered as v0).
    promptVersion: text("prompt_version"),
    agentPhase: text("agent_phase"),
    agentOptions: jsonb("agent_options").$type<AgentOptions>(),
    agentSessionId: text("agent_session_id"),
    agentContainerId: text("agent_container_id"),
    agentExitCode: integer("agent_exit_code"),
    agentUsage: jsonb("agent_usage").$type<AgentUsage>(),
    agentFinalMessage: text("agent_final_message"),
    requestCount: integer("request_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("research_runs_one_active_idx")
      .on(t.companyId)
      .where(sql`${t.status} IN ('queued', 'running')`),
    index("research_runs_company_job_idx").on(t.companyJobId, t.id),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("run_events_run_idx").on(t.runId, t.id)],
);

// Per-run agent bearer tokens (Stage 3b Step 1): one per agent run, scoped
// to the run's company, revoked when the run ends. Only the hash is stored.
export const runTokens = pgTable("run_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .unique()
    .references(() => researchRuns.id, { onDelete: "cascade" }),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const blobs = pgTable("blobs", {
  sha256: text("sha256").primaryKey(),
  contentType: text("content_type"),
  // Original byte length (before gzip).
  size: integer("size").notNull(),
  gzip: bytea("gzip").notNull(),
});

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url").notNull(),
    collector: text("collector").notNull(),
    status: sourceStatus("status").notNull(),
    httpStatus: integer("http_status"),
    error: text("error"),
    title: text("title"),
    via: text("via"),
    thin: boolean("thin").notNull().default(false),
    details: jsonb("details").$type<Record<string, unknown> | null>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    blobSha256: text("blob_sha256").references(() => blobs.sha256),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('english', "url" || ' ' || coalesce("error", ''))`,
    ),
  },
  (t) => [
    index("sources_run_idx").on(t.runId),
    index("sources_company_idx").on(t.companyId),
    index("sources_tsv_idx").using("gin", t.tsv),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "cascade" }),
    area: area("area"),
    kind: documentKind("kind").notNull(),
    title: text("title").notNull(),
    path: text("path"),
    version: integer("version").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    contentMd: text("content_md").notNull(),
    sourceIds: uuid("source_ids").array().notNull().default([]),
    factIds: uuid("fact_ids").array().notNull().default([]),
    recordIds: uuid("record_ids").array().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    createdBy: text("created_by").notNull(),
    contentSha256: text("content_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', "title"), 'A') || to_tsvector('english', "content_md")`,
    ),
  },
  (t) => [
    index("documents_company_idx").on(t.companyId),
    index("documents_tsv_idx").using("gin", t.tsv),
    uniqueIndex("documents_company_path_current_idx")
      .on(t.companyId, t.path)
      .where(sql`${t.isCurrent} = true`),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "cascade" }),
    area: area("area").notNull(),
    claim: text("claim").notNull(),
    detail: text("detail"),
    sourceIds: uuid("source_ids").array().notNull(),
    factIds: uuid("fact_ids").array().notNull().default([]),
    recordIds: uuid("record_ids").array().notNull().default([]),
    verification: verificationStatus("verification").notNull().default("unverified"),
    quote: text("quote"),
    quoteSourceId: uuid("quote_source_id"),
    tags: text("tags").array().notNull().default([]),
    confidence: confidence("confidence").notNull(),
    status: findingStatus("status").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("findings_source_ids_not_empty", sql`cardinality(${t.sourceIds}) > 0`),
    index("findings_company_idx").on(t.companyId),
  ],
);

export const areaStatuses = pgTable(
  "area_statuses",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    area: area("area").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: areaStatus("status").notNull(),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.area] }),
    check("area_statuses_reason_required", sql`${t.status} = 'done' OR ${t.reason} IS NOT NULL`),
  ],
);

export type ResearchRun = typeof researchRuns.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type RunToken = typeof runTokens.$inferSelect;
export type Blob = typeof blobs.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type ResearchDocument = typeof documents.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type AreaStatusRow = typeof areaStatuses.$inferSelect;
export type FactKey = typeof factKeys.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type RecordTypeRow = typeof recordTypes.$inferSelect;
export type ResearchRecord = typeof records.$inferSelect;

// Latest fact per (company, key, qualifiers).
export const factsCurrent = pgView("facts_current").as((qb) =>
  qb
    .selectDistinctOn([facts.companyId, facts.key, facts.qualifiers], {
      id: facts.id,
      companyId: facts.companyId,
      runId: facts.runId,
      key: facts.key,
      area: facts.area,
      valueNum: facts.valueNum,
      valueText: facts.valueText,
      valueDate: facts.valueDate,
      valueBool: facts.valueBool,
      valueJson: facts.valueJson,
      currency: facts.currency,
      qualifiers: facts.qualifiers,
      asOf: facts.asOf,
      sourceIds: facts.sourceIds,
      confidence: facts.confidence,
      verification: facts.verification,
      quote: facts.quote,
      quoteSourceId: facts.quoteSourceId,
      createdBy: facts.createdBy,
      createdAt: facts.createdAt,
      supersedesId: facts.supersedesId,
    })
    .from(facts)
    .orderBy(facts.companyId, facts.key, facts.qualifiers, desc(facts.createdAt), desc(facts.id)),
);
export type CurrentFact = typeof factsCurrent.$inferSelect;

// ---- Stage 4.1 Step 5: bulk jobs (DB-backed queue feeding) ----

export const bulkJobKind = pgEnum("bulk_job_kind", ["research", "collect"]);
export const bulkJobScope = pgEnum("bulk_job_scope", ["sector", "shortlist"]);
export const bulkJobStatus = pgEnum("bulk_job_status", ["running", "paused", "completed", "cancelled"]);
export const bulkItemStatus = pgEnum("bulk_item_status", [
  "queued",
  "running",
  "extracting",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

export const bulkJobs = pgTable("bulk_jobs", {
  id: uuid("id").primaryKey(),
  kind: bulkJobKind("kind").notNull(),
  scope: bulkJobScope("scope").notNull(),
  status: bulkJobStatus("status").notNull().default("running"),
  sectorId: uuid("sector_id").references(() => sectors.id, { onDelete: "set null" }),
  shortlistId: uuid("shortlist_id").references(() => shortlists.id, { onDelete: "set null" }),
  maxCompanies: integer("max_companies"),
  maxInputTokens: bigint("max_input_tokens", { mode: "number" }),
  maxHours: doublePrecision("max_hours"),
  skipIfRecentDays: integer("skip_if_recent_days").notNull().default(14),
  promptVersion: text("prompt_version"),
  errorStreak: integer("error_streak").notNull().default(0),
  errorClass: text("error_class"),
  pauseReason: text("pause_reason"),
  startedRuns: integer("started_runs").notNull().default(0),
  inputTokensSpent: bigint("input_tokens_spent", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export type BulkJob = typeof bulkJobs.$inferSelect;

export const bulkJobItems = pgTable(
  "bulk_job_items",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => bulkJobs.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: bulkItemStatus("status").notNull().default("queued"),
    position: integer("position").notNull().default(0),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "set null" }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    errorClass: text("error_class"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("bulk_job_items_job_company_idx").on(t.jobId, t.companyId)],
);
export type BulkJobItem = typeof bulkJobItems.$inferSelect;

// ---- Stage 4.1 Step 5: harness settings (runtime-adjustable, DB-backed) ----

export const harnessSettings = pgTable("harness_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type HarnessSetting = typeof harnessSettings.$inferSelect;

// ---- Stage 5: company jobs (one job per company, subjobs per stage) ----

export const companyJobs = pgTable(
  "company_jobs",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    status: companyJobStatus("status").notNull().default("queued"),
    currentStage: companyJobStage("current_stage"),
    errorStreak: integer("error_streak").notNull().default(0),
    errorClass: text("error_class"),
    pauseReason: text("pause_reason"),
    maxInputTokens: bigint("max_input_tokens", { mode: "number" }),
    maxHours: doublePrecision("max_hours"),
    inputTokensSpent: bigint("input_tokens_spent", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // AC-1: at most one active company job per company.
    uniqueIndex("company_jobs_one_active_idx")
      .on(t.companyId)
      .where(sql`${t.status} IN ('queued', 'running', 'paused')`),
  ],
);
export type CompanyJob = typeof companyJobs.$inferSelect;

export const preflightReports = pgTable(
  "preflight_reports",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => companyJobs.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    reportVersion: integer("report_version").notNull().default(1),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("preflight_reports_job_version_idx").on(t.jobId, t.reportVersion)],
);
export type PreflightReport = typeof preflightReports.$inferSelect;

// ---- Stage 5: run logging (providers, job events, HTTP fetches) ----

export const providerCalls = pgTable(
  "provider_calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyJobId: uuid("company_job_id").references(() => companyJobs.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "cascade" }),
    stage: companyJobStage("stage").notNull(),
    // Natural key from the CLI's goal_usage_attribution records; null for
    // dispatch-time prompt rows filled in when attribution arrives.
    usageId: text("usage_id"),
    sessionId: text("session_id"),
    childSessionId: text("child_session_id"),
    seq: integer("seq").notNull().default(0),
    responseId: text("response_id"),
    model: text("model"),
    provider: text("provider"),
    promptSha256: text("prompt_sha256").references(() => blobs.sha256),
    responseSha256: text("response_sha256").references(() => blobs.sha256),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd"),
    durationMs: integer("duration_ms"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_calls_usage_idx").on(t.usageId).where(sql`${t.usageId} IS NOT NULL`),
    index("provider_calls_job_idx").on(t.companyJobId, t.id),
    index("provider_calls_run_idx").on(t.runId, t.id),
  ],
);
export type ProviderCall = typeof providerCalls.$inferSelect;

export const jobEvents = pgTable(
  "job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => companyJobs.id, { onDelete: "cascade" }),
    stage: companyJobStage("stage"),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.id)],
);
export type JobEvent = typeof jobEvents.$inferSelect;

export const httpFetches = pgTable(
  "http_fetches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyJobId: uuid("company_job_id").references(() => companyJobs.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "set null" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    collector: text("collector").notNull(),
    url: text("url").notNull(),
    host: text("host").notNull(),
    method: text("method").notNull().default("GET"),
    statusCode: integer("status_code"),
    bytes: integer("bytes"),
    durationMs: integer("duration_ms"),
    cached: boolean("cached").notNull().default(false),
    area: text("area"),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    error: text("error"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("http_fetches_job_idx").on(t.companyJobId, t.id),
    index("http_fetches_run_idx").on(t.runId, t.id),
  ],
);
export type HttpFetch = typeof httpFetches.$inferSelect;

// ---- Stage 5.1: sector preflight (eligibility pass) ----

export const sectorPreflight = pgTable(
  "sector_preflight",
  {
    id: uuid("id").primaryKey(),
    sectorId: uuid("sector_id")
      .notNull()
      .references(() => sectors.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "set null" }),
    businessType: text("business_type").notNull(),
    primaryCategory: text("primary_category").notNull(),
    sellsOwnProducts: boolean("sells_own_products").notNull(),
    hasOnlineStore: boolean("has_online_store").notNull(),
    shipsTo: text("ships_to").array().notNull().default([]),
    confidence: confidence("confidence").notNull(),
    reason: text("reason").notNull(),
    quote: text("quote"),
    quoteSourceId: uuid("quote_source_id"),
    verification: verificationStatus("verification").notNull().default("unverified"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("sector_preflight_sector_company_idx").on(t.sectorId, t.companyId)],
);
export type SectorPreflight = typeof sectorPreflight.$inferSelect;
