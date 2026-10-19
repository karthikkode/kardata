import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { companies, sectorCompanies, sectors, type Company } from "../db/schema.js";
import type { Db, DbLike } from "../db/client.js";
import { normalizeDomain } from "../lib/apollo/parse.js";
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
  source: "apollo" | "manual";
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

export interface CompanyListItem extends EffectiveCompany {
  removed: boolean;
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

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullableNumber(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
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

  const dir: 1 | -1 = order === "asc" ? 1 : -1;
  const memberships = await db
    .select({ company: companies, removedAt: sectorCompanies.removedAt })
    .from(sectorCompanies)
    .innerJoin(companies, eq(sectorCompanies.companyId, companies.id))
    .where(eq(sectorCompanies.sectorId, sectorId));

  const query = search.trim().toLowerCase();
  const bands = new Set(employeeBand);
  const countries = new Set(country);
  const industries = new Set(industry);
  const techs = new Set(technologiesAny.map((t) => t.toLowerCase()));

  const items: CompanyListItem[] = [];
  for (const { company, removedAt } of memberships) {
    const removed = removedAt !== null;
    if (removed && !includeRemoved) continue;
    const effective = toEffectiveCompany(company);
    if (query !== "") {
      const hay = [effective.name ?? "", effective.domain ?? ""].map((s) => s.toLowerCase());
      const inNameOrDomain = hay.some((s) => s.includes(query));
      const inKeywords = effective.keywords.some((k) => k.toLowerCase().includes(query));
      if (!inNameOrDomain && !inKeywords) continue;
    }
    if (countries.size > 0 && (effective.country === null || !countries.has(effective.country))) {
      continue;
    }
    if (industries.size > 0 && (effective.industry === null || !industries.has(effective.industry))) {
      continue;
    }
    if (bands.size > 0) {
      const band = bandOf(effective.employees);
      if (band === null || !bands.has(band)) continue;
    }
    if (techs.size > 0) {
      const have = effective.technologies.map((t) => t.toLowerCase());
      if (!have.some((t) => techs.has(t))) continue;
    }
    if (hasFunding !== undefined && (effective.totalFunding !== null) !== hasFunding) continue;
    if (sharedDomain !== undefined && effective.sharedDomain !== sharedDomain) continue;
    items.push({ ...effective, removed });
  }

  items.sort((a, b) => {
    let cmp: number;
    switch (sort) {
      case "name":
        cmp = compareStrings((a.name ?? "").toLowerCase(), (b.name ?? "").toLowerCase()) * dir;
        break;
      case "employees":
        cmp = compareNullableNumber(a.employees, b.employees, dir);
        break;
      case "founded":
        cmp = compareNullableNumber(a.foundedYear, b.foundedYear, dir);
        break;
      case "revenue":
        cmp = compareNullableNumber(
          a.annualRevenue === null ? null : Number(a.annualRevenue),
          b.annualRevenue === null ? null : Number(b.annualRevenue),
          dir,
        );
        break;
    }
    return cmp !== 0 ? cmp : compareStrings(a.id, b.id);
  });

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize, totalPages };
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

function topEntries(counts: Map<string, number>, limit: number): FacetEntry[] {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || compareStrings(a.value, b.value))
    .slice(0, limit);
}

export async function facets(db: Db, sectorId: string): Promise<Facets> {
  await requireSector(db, sectorId);
  const rows = await db
    .select({ company: companies, removedAt: sectorCompanies.removedAt })
    .from(sectorCompanies)
    .innerJoin(companies, eq(sectorCompanies.companyId, companies.id))
    .where(eq(sectorCompanies.sectorId, sectorId));
  const countries = new Map<string, number>();
  const industries = new Map<string, number>();
  const technologies = new Map<string, number>();
  const bands = new Map<EmployeeBand, number>(EMPLOYEE_BANDS.map((b) => [b, 0]));
  for (const { company, removedAt } of rows) {
    if (removedAt !== null) continue;
    const effective = toEffectiveCompany(company);
    if (effective.country !== null) countries.set(effective.country, (countries.get(effective.country) ?? 0) + 1);
    if (effective.industry !== null) {
      industries.set(effective.industry, (industries.get(effective.industry) ?? 0) + 1);
    }
    const band = bandOf(effective.employees);
    if (band !== null) bands.set(band, (bands.get(band) ?? 0) + 1);
    for (const tech of new Set(effective.technologies)) {
      technologies.set(tech, (technologies.get(tech) ?? 0) + 1);
    }
  }
  return {
    countries: topEntries(countries, Number.MAX_SAFE_INTEGER),
    industries: topEntries(industries, Number.MAX_SAFE_INTEGER),
    employeeBands: EMPLOYEE_BANDS.map((band) => ({ band, count: bands.get(band) ?? 0 })),
    technologies: topEntries(technologies, 50),
  };
}
