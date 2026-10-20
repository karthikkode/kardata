import { desc, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  customType,
  date,
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

export const runKind = pgEnum("run_kind", ["collect", "agent", "manual"]);
export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "stalled",
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
    error: text("error"),
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
      createdBy: facts.createdBy,
      createdAt: facts.createdAt,
      supersedesId: facts.supersedesId,
    })
    .from(facts)
    .orderBy(facts.companyId, facts.key, facts.qualifiers, desc(facts.createdAt), desc(facts.id)),
);
export type CurrentFact = typeof factsCurrent.$inferSelect;
