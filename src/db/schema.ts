import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
