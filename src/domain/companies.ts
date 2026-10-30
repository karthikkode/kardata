import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { companies, sectorCompanies, sectors, type Company } from "../db/schema.js";
import type { Db, DbLike } from "../db/client.js";
import { normalizeDomain } from "../lib/apollo/parse.js";
import { effectiveCompanies } from "./effective.js";
import { DomainError } from "./errors.js";

export type OverrideMap = Record<string, unknown>;

const STRING_FIELDS = new Set([
  "name",
  "website",
  "linkedinUrl",
  "facebookUrl",
  "twitterUrl",
  "industry",
  "country",
  "state",
  "city",
  "postalCode",
  "address",
  "phone",
  "latestFunding",
  "shortDescription",
  "logoUrl",
]);
const INT_FIELDS = new Set(["employees", "foundedYear"]);
const NUMERIC_FIELDS = new Set(["annualRevenue", "totalFunding", "latestFundingAmount"]);
const DATE_FIELDS = new Set(["lastRaisedAt"]);
const LIST_FIELDS = new Set(["keywords", "technologies", "sicCodes", "naicsCodes"]);

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function cleanList(key: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new DomainError("invalid_input", `${key} must be an array of strings`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new DomainError("invalid_input", `${key} must be an array of strings`);
    }
    const trimmed = item.trim();
    if (trimmed === "") continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}

/** Validate one typed-field value; returns the canonical stored form. */
function validateTypedField(key: string, value: unknown): unknown {
  if (key === "domain") {
    throw new DomainError("invalid_input", "domain is derived from website and cannot be set directly");
  }
  if (STRING_FIELDS.has(key)) {
    if (typeof value !== "string") throw new DomainError("invalid_input", `${key} must be a string`);
    return value.trim();
  }
  if (INT_FIELDS.has(key)) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new DomainError("invalid_input", `${key} must be an integer`);
    }
    return value;
  }
  if (NUMERIC_FIELDS.has(key)) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new DomainError("invalid_input", `${key} must be numeric`);
      return String(value);
    }
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
    throw new DomainError("invalid_input", `${key} must be numeric`);
  }
  if (DATE_FIELDS.has(key)) {
    if (typeof value !== "string" || !isValidDate(value.trim())) {
      throw new DomainError("invalid_input", `${key} must be a YYYY-MM-DD date`);
    }
    return value.trim();
  }
  if (LIST_FIELDS.has(key)) return cleanList(key, value);
  throw new DomainError("invalid_input", `unknown or read-only field: ${key}`);
}

export interface EffectiveCompany {
  id: string;
  apolloAccountId: string | null;
  secCrd: string | null;
  source: "apollo" | "manual" | "sec";
  domain: string | null;
  sharedDomain: boolean;
  name: string | null;
  website: string | null;
  linkedinUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  employees: number | null;
  industry: string | null;
  keywords: string[];
  technologies: string[];
  country: string | null;
  state: string | null;
  city: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  annualRevenue: string | null;
  totalFunding: string | null;
  latestFunding: string | null;
  latestFundingAmount: string | null;
  lastRaisedAt: string | null;
  foundedYear: number | null;
  shortDescription: string | null;
  logoUrl: string | null;
  sicCodes: string[];
  naicsCodes: string[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanySectorMembership {
  id: string;
  name: string;
  removed: boolean;
}

export interface CompanyView extends EffectiveCompany {
  overrides: OverrideMap;
  raw: Record<string, unknown>;
  sectors: CompanySectorMembership[];
}

export interface CompanyListItem {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  employees: number | null;
  industry: string | null;
  foundedYear: number | null;
  annualRevenue: string | null;
  totalFunding: string | null;
  technologyCount: number;
  sharedDomain: boolean;
  source: "apollo" | "manual" | "sec";
  removed: boolean;
  hasOverrides: boolean;
}

function pick<T>(row: Company, overrides: OverrideMap, key: keyof Company): T {
  if (key in overrides) return overrides[key] as T;
  return row[key] as unknown as T;
}

/**
 * Every field is `override ?? imported`, except `domain`, which follows the
 * effective website: it is the stored domain unless the website is overridden.
 */
export function toEffectiveCompany(row: Company): EffectiveCompany {
  const overrides = (row.overrides ?? {}) as OverrideMap;
  const website = pick<string | null>(row, overrides, "website");
  return {
    id: row.id,
    apolloAccountId: row.apolloAccountId,
    secCrd: row.secCrd,
    source: row.source,
    domain: "website" in overrides ? normalizeDomain(website) : row.domain,
    sharedDomain: row.sharedDomain,
    name: pick(row, overrides, "name"),
    website,
    linkedinUrl: pick(row, overrides, "linkedinUrl"),
    facebookUrl: pick(row, overrides, "facebookUrl"),
    twitterUrl: pick(row, overrides, "twitterUrl"),
    employees: pick(row, overrides, "employees"),
    industry: pick(row, overrides, "industry"),
    keywords: pick<string[] | null>(row, overrides, "keywords") ?? [],
    technologies: pick<string[] | null>(row, overrides, "technologies") ?? [],
    country: pick(row, overrides, "country"),
    state: pick(row, overrides, "state"),
    city: pick(row, overrides, "city"),
    postalCode: pick(row, overrides, "postalCode"),
    address: pick(row, overrides, "address"),
    phone: pick(row, overrides, "phone"),
    annualRevenue: pick(row, overrides, "annualRevenue"),
    totalFunding: pick(row, overrides, "totalFunding"),
    latestFunding: pick(row, overrides, "latestFunding"),
    latestFundingAmount: pick(row, overrides, "latestFundingAmount"),
    lastRaisedAt: pick(row, overrides, "lastRaisedAt"),
    foundedYear: pick(row, overrides, "foundedYear"),
    shortDescription: pick(row, overrides, "shortDescription"),
    logoUrl: pick(row, overrides, "logoUrl"),
    sicCodes: pick<string[] | null>(row, overrides, "sicCodes") ?? [],
    naicsCodes: pick<string[] | null>(row, overrides, "naicsCodes") ?? [],
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toCompanyView(row: Company, memberships: CompanySectorMembership[]): CompanyView {
  return {
    ...toEffectiveCompany(row),
    overrides: (row.overrides ?? {}) as OverrideMap,
    raw: (row.raw ?? {}) as Record<string, unknown>,
    sectors: memberships,
  };
}

/** Set `shared_domain` truthfully for every company holding one of `domains`. */
export async function recomputeSharedDomains(db: DbLike, domains: Iterable<string>): Promise<void> {
  const list = [...new Set([...domains].filter((d) => d !== ""))];
  if (list.length === 0) return;
  const counts = await db
    .select({ domain: companies.domain })
    .from(companies)
    .where(inArray(companies.domain, list));
  const byDomain = new Map<string, number>();
  for (const row of counts) {
    if (row.domain !== null) byDomain.set(row.domain, (byDomain.get(row.domain) ?? 0) + 1);
  }
  const shared = [...byDomain.entries()].filter(([, n]) => n > 1).map(([d]) => d);
  const unshared = [...byDomain.keys()].filter((d) => !shared.includes(d));
  if (shared.length > 0) {
    await db
      .update(companies)
      .set({ sharedDomain: true })
      .where(inArray(companies.domain, shared));
  }
  if (unshared.length > 0) {
    await db
      .update(companies)
      .set({ sharedDomain: false })
      .where(inArray(companies.domain, unshared));
  }
}

async function requireSector(db: DbLike, sectorId: string) {
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, sectorId) });
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  return sector;
}

async function membershipsOf(db: DbLike, companyId: string): Promise<CompanySectorMembership[]> {
  const rows = await db
    .select({ id: sectors.id, name: sectors.name, removedAt: sectorCompanies.removedAt })
    .from(sectorCompanies)
    .innerJoin(sectors, eq(sectorCompanies.sectorId, sectors.id))
    .where(eq(sectorCompanies.companyId, companyId));
  return rows.map((r) => ({ id: r.id, name: r.name, removed: r.removedAt !== null }));
}

export interface AddCompanyInput {
  name: string;
  domain?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  employees?: number | null;
  industry?: string | null;
  keywords?: string[];
  technologies?: string[];
  country?: string | null;
  state?: string | null;
  city?: string | null;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  annualRevenue?: string | number | null;
  totalFunding?: string | number | null;
  latestFunding?: string | null;
  latestFundingAmount?: string | number | null;
  lastRaisedAt?: string | null;
  foundedYear?: number | null;
  shortDescription?: string | null;
  logoUrl?: string | null;
  sicCodes?: string[];
  naicsCodes?: string[];
  notes?: string | null;
}

export interface PossibleDuplicate {
  id: string;
  name: string | null;
  domain: string | null;
}

function validatedInsert(input: AddCompanyInput): Omit<typeof companies.$inferInsert, "id" | "source"> {
  const { name, domain, website, notes, ...rest } = input;
  const out: Record<string, unknown> = {};
  if (website !== undefined && website !== null) {
    if (typeof website !== "string") throw new DomainError("invalid_input", "website must be a string");
    out.website = website.trim() === "" ? null : website.trim();
  } else {
    out.website = null;
  }
  if (domain !== undefined && domain !== null) {
    if (typeof domain !== "string") throw new DomainError("invalid_input", "domain must be a string");
    out.domain = normalizeDomain(domain.trim());
  } else {
    out.domain = normalizeDomain(typeof out.website === "string" ? out.website : null);
  }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    out[key] = value === null ? null : validateTypedField(key, value);
  }
  void name;
  return { notes: notes ?? null, ...out } as Omit<typeof companies.$inferInsert, "id" | "source">;
}

export async function addCompany(
  db: Db,
  sectorId: string,
  input: AddCompanyInput,
): Promise<{ company: CompanyView; possibleDuplicates: PossibleDuplicate[] }> {
  if (typeof input.name !== "string" || input.name.trim() === "") {
    throw new DomainError("invalid_input", "company name is required");
  }
  const insert = validatedInsert(input);
  return db.transaction(async (tx) => {
    const sector = await requireSector(tx, sectorId);
    let possibleDuplicates: PossibleDuplicate[] = [];
    if (insert.domain) {
      possibleDuplicates = await tx
        .select({ id: companies.id, name: companies.name, domain: companies.domain })
        .from(companies)
        .where(eq(companies.domain, insert.domain));
    }
    const [row] = await tx
      .insert(companies)
      .values({
        id: randomUUID(),
        source: "manual",
        name: input.name.trim(),
        ...insert,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    await tx.insert(sectorCompanies).values({
      sectorId,
      companyId: row.id,
      addedVia: "manual",
    });
    if (row.domain) await recomputeSharedDomains(tx, [row.domain]);
    const fresh = await tx.query.companies.findFirst({ where: eq(companies.id, row.id) });
    if (!fresh) throw new Error("inserted row is missing");
    const view = toCompanyView(fresh, [{ id: sector.id, name: sector.name, removed: false }]);
    return { company: view, possibleDuplicates };
  });
}

export async function addCompanyToSector(
  db: Db,
  sectorId: string,
  companyId: string,
): Promise<{ sectorId: string; companyId: string; revived: boolean }> {
  return db.transaction(async (tx) => {
    await requireSector(tx, sectorId);
    const company = await tx.query.companies.findFirst({ where: eq(companies.id, companyId) });
    if (!company) throw new DomainError("not_found", `company not found: ${companyId}`);
    const existing = await tx.query.sectorCompanies.findFirst({
      where: and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)),
    });
    if (existing && existing.removedAt === null) {
      throw new DomainError("conflict", "company is already in this sector");
    }
    if (existing) {
      await tx
        .update(sectorCompanies)
        .set({ removedAt: null })
        .where(
          and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)),
        );
      return { sectorId, companyId, revived: true };
    }
    await tx.insert(sectorCompanies).values({ sectorId, companyId, addedVia: "manual" });
    return { sectorId, companyId, revived: false };
  });
}

export interface UpdateCompanyPatch {
  notes?: string | null;
  [field: string]: unknown;
}

function effectiveDomainOf(row: Company, overrides: OverrideMap): string | null {
  if ("website" in overrides) {
    return normalizeDomain((overrides.website ?? null) as string | null);
  }
  return row.domain;
}

export async function updateCompany(
  db: Db,
  id: string,
  patch: UpdateCompanyPatch,
): Promise<CompanyView> {
  return db.transaction(async (tx) => {
    const row = await tx.query.companies.findFirst({ where: eq(companies.id, id) });
    if (!row) throw new DomainError("not_found", `company not found: ${id}`);
    const oldDomain = effectiveDomainOf(row, (row.overrides ?? {}) as OverrideMap);
    const overrides: OverrideMap = { ...((row.overrides ?? {}) as OverrideMap) };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "notes" || value === undefined) continue;
      if (value === null) {
        delete overrides[key];
      } else {
        overrides[key] = validateTypedField(key, value);
      }
    }
    let notes = row.notes;
    if ("notes" in patch) {
      const value = patch.notes;
      if (value !== null && typeof value !== "string") {
        throw new DomainError("invalid_input", "notes must be a string or null");
      }
      notes = value;
    }
    const [updated] = await tx
      .update(companies)
      .set({ overrides, notes })
      .where(eq(companies.id, id))
      .returning();
    if (!updated) throw new Error("update returned no row");
    const newDomain = effectiveDomainOf(updated, overrides);
    if (oldDomain !== newDomain) {
      await recomputeSharedDomains(
        tx,
        [oldDomain, newDomain].filter((d): d is string => d !== null),
      );
    }
    return toCompanyView(updated, await membershipsOf(tx, id));
  });
}

export async function removeCompany(
  db: Db,
  sectorId: string,
  companyId: string,
): Promise<{ sectorId: string; companyId: string; removedAt: Date }> {
  const existing = await db.query.sectorCompanies.findFirst({
    where: and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)),
  });
  if (!existing) throw new DomainError("not_found", "company is not in this sector");
  const [row] = await db
    .update(sectorCompanies)
    .set({ removedAt: new Date() })
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)))
    .returning();
  if (!row?.removedAt) throw new Error("remove returned no row");
  return { sectorId, companyId, removedAt: row.removedAt };
}

export async function restoreCompany(
  db: Db,
  sectorId: string,
  companyId: string,
): Promise<{ sectorId: string; companyId: string }> {
  const existing = await db.query.sectorCompanies.findFirst({
    where: and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)),
  });
  if (!existing) throw new DomainError("not_found", "company is not in this sector");
  await db
    .update(sectorCompanies)
    .set({ removedAt: null })
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));
  return { sectorId, companyId };
}

export async function getCompany(db: Db, id: string): Promise<CompanyView> {
  const row = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!row) throw new DomainError("not_found", `company not found: ${id}`);
  return toCompanyView(row, await membershipsOf(db, id));
}

export type EmployeeBand = "1-10" | "11-50" | "51-200" | "201-500" | "501+";

const EMPLOYEE_BANDS: EmployeeBand[] = ["1-10", "11-50", "51-200", "201-500", "501+"];

export function bandOf(employees: number | null): EmployeeBand | null {
  if (employees === null || !Number.isInteger(employees) || employees < 1) return null;
  if (employees <= 10) return "1-10";
  if (employees <= 50) return "11-50";
  if (employees <= 200) return "51-200";
  if (employees <= 500) return "201-500";
  return "501+";
}

export type CompanySort = "name" | "employees" | "founded" | "revenue";

export interface ListCompaniesOptions {
  search?: string;
  country?: string[];
  employeeBand?: EmployeeBand[];
  industry?: string[];
  technologiesAny?: string[];
  hasFunding?: boolean;
  sharedDomain?: boolean;
  includeRemoved?: boolean;
  sort?: CompanySort;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface CompanyListResult {
  items: CompanyListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const SORTS: CompanySort[] = ["name", "employees", "founded", "revenue"];

function escapeLike(q: string): string {
  return `%${q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

function inList(values: string[]): SQL {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

export async function listCompanies(
  db: Db,
  sectorId: string,
  options: ListCompaniesOptions = {},
): Promise<CompanyListResult> {
  await requireSector(db, sectorId);
  const {
    search = "",
    country = [],
    employeeBand = [],
    industry = [],
    technologiesAny = [],
    hasFunding,
    sharedDomain,
    includeRemoved = false,
    sort = "name",
    order = "asc",
    page = 1,
    pageSize = 50,
  } = options;
  if (!SORTS.includes(sort)) throw new DomainError("invalid_input", `unknown sort: ${String(sort)}`);
  if (order !== "asc" && order !== "desc") {
    throw new DomainError("invalid_input", `unknown order: ${String(order)}`);
  }
  if (!Number.isInteger(page) || page < 1) throw new DomainError("invalid_input", "page must be >= 1");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new DomainError("invalid_input", "pageSize must be between 1 and 200");
  }
  for (const band of employeeBand) {
    if (!EMPLOYEE_BANDS.includes(band)) throw new DomainError("invalid_input", `unknown band: ${band}`);
  }
  for (const [label, value] of [
    ["country", country],
    ["industry", industry],
    ["technologiesAny", technologiesAny],
  ] as const) {
    if (!Array.isArray(value)) throw new DomainError("invalid_input", `${label} must be an array`);
  }

  const e = effectiveCompanies(db);
  const conds: SQL[] = [eq(sectorCompanies.sectorId, sectorId)];
  if (!includeRemoved) conds.push(isNull(sectorCompanies.removedAt));
  const query = search.trim();
  if (query !== "") {
    const q = escapeLike(query);
    conds.push(
      sql`(${e.name} ILIKE ${q} OR ${e.domain} ILIKE ${q} OR EXISTS (SELECT 1 FROM unnest(${e.keywords}) AS k WHERE k ILIKE ${q}))`,
    );
  }
  if (country.length > 0) conds.push(sql`${e.country} IN ${inList(country)}`);
  if (industry.length > 0) conds.push(sql`${e.industry} IN ${inList(industry)}`);
  if (employeeBand.length > 0) {
    const preds = employeeBand.map((band) =>
      band === "1-10"
        ? sql`(${e.employees} BETWEEN 1 AND 10)`
        : band === "11-50"
          ? sql`(${e.employees} BETWEEN 11 AND 50)`
          : band === "51-200"
            ? sql`(${e.employees} BETWEEN 51 AND 200)`
            : band === "201-500"
              ? sql`(${e.employees} BETWEEN 201 AND 500)`
              : sql`(${e.employees} >= 501)`,
    );
    conds.push(sql`(${sql.join(preds, sql` OR `)})`);
  }
  if (technologiesAny.length > 0) {
    const techs = technologiesAny.map((t) => t.toLowerCase());
    conds.push(
      sql`EXISTS (SELECT 1 FROM unnest(${e.technologies}) AS t WHERE lower(t) IN ${inList(techs)})`,
    );
  }
  if (hasFunding !== undefined) {
    conds.push(hasFunding ? sql`${e.totalFunding} IS NOT NULL` : sql`${e.totalFunding} IS NULL`);
  }
  if (sharedDomain !== undefined) conds.push(eq(e.sharedDomain, sharedDomain));
  const where = and(...conds);

  const direction = order === "asc" ? sql`ASC` : sql`DESC`;
  const orderBy =
    sort === "name"
      ? sql`lower(COALESCE(${e.name}, '')) COLLATE "C" ${direction}, ${e.id} ASC`
      : sort === "employees"
        ? sql`${e.employees} ${direction} NULLS LAST, ${e.id} ASC`
        : sort === "founded"
          ? sql`${e.foundedYear} ${direction} NULLS LAST, ${e.id} ASC`
          : sql`${e.annualRevenue} ${direction} NULLS LAST, ${e.id} ASC`;

  const rows = await db
    .select({
      id: e.id,
      name: e.name,
      domain: e.domain,
      website: e.website,
      country: e.country,
      city: e.city,
      employees: e.employees,
      industry: e.industry,
      foundedYear: e.foundedYear,
      annualRevenue: e.annualRevenue,
      totalFunding: e.totalFunding,
      technologyCount: sql<number>`cardinality(${e.technologies})`,
      sharedDomain: e.sharedDomain,
      source: e.source,
      removedAt: sectorCompanies.removedAt,
      hasOverrides: e.hasOverrides,
    })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(where)
    .orderBy(orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const counted = await db
    .select({ n: count().mapWith(Number) })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(where);
  const total = counted[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items: rows.map(
      (r): CompanyListItem => ({
        id: r.id,
        name: r.name,
        domain: r.domain,
        website: r.website,
        country: r.country,
        city: r.city,
        employees: r.employees,
        industry: r.industry,
        foundedYear: r.foundedYear,
        annualRevenue: r.annualRevenue,
        totalFunding: r.totalFunding,
        technologyCount: r.technologyCount,
        sharedDomain: r.sharedDomain,
        source: r.source,
        removed: r.removedAt !== null,
        hasOverrides: r.hasOverrides,
      }),
    ),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export interface FacetEntry {
  value: string;
  count: number;
}

export interface Facets {
  countries: FacetEntry[];
  industries: FacetEntry[];
  employeeBands: { band: EmployeeBand; count: number }[];
  technologies: FacetEntry[];
}

export async function facets(db: Db, sectorId: string): Promise<Facets> {
  await requireSector(db, sectorId);
  const e = effectiveCompanies(db);
  const live = and(eq(sectorCompanies.sectorId, sectorId), isNull(sectorCompanies.removedAt));

  const countryRows = await db
    .select({
      value: sql<string | null>`${e.country}`.as("value"),
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(and(live, sql`${e.country} IS NOT NULL`))
    .groupBy(e.country)
    .orderBy(sql`count DESC, value`);
  const industryRows = await db
    .select({
      value: sql<string | null>`${e.industry}`.as("value"),
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(and(live, sql`${e.industry} IS NOT NULL`))
    .groupBy(e.industry)
    .orderBy(sql`count DESC, value`);
  const [bandRow] = await db
    .select({
      b1: sql<number>`COUNT(*) FILTER (WHERE ${e.employees} BETWEEN 1 AND 10)::int`,
      b2: sql<number>`COUNT(*) FILTER (WHERE ${e.employees} BETWEEN 11 AND 50)::int`,
      b3: sql<number>`COUNT(*) FILTER (WHERE ${e.employees} BETWEEN 51 AND 200)::int`,
      b4: sql<number>`COUNT(*) FILTER (WHERE ${e.employees} BETWEEN 201 AND 500)::int`,
      b5: sql<number>`COUNT(*) FILTER (WHERE ${e.employees} >= 501)::int`,
    })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(live);
  const techInner = db
    .select({ t: sql<string>`unnest(${e.technologies})`.as("t") })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(live)
    .as("s");
  const techRows = await db
    .select({
      value: sql<string>`${techInner.t}`.as("value"),
      count: sql<number>`COUNT(*)::int`.as("count"),
    })
    .from(techInner)
    .groupBy(techInner.t)
    .orderBy(sql`count DESC, value`)
    .limit(50);

  const bands = bandRow ?? { b1: 0, b2: 0, b3: 0, b4: 0, b5: 0 };
  const defined = (rows: { value: string | null; count: number }[]): FacetEntry[] =>
    rows.flatMap((r) => (r.value === null ? [] : [{ value: r.value, count: r.count }]));
  return {
    countries: defined(countryRows),
    industries: defined(industryRows),
    employeeBands: EMPLOYEE_BANDS.map((band, i) => ({
      band,
      count: [bands.b1, bands.b2, bands.b3, bands.b4, bands.b5][i] ?? 0,
    })),
    technologies: defined(techRows),
  };
}
