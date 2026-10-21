import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  factKeys,
  factsCurrent,
  sectorCompanies,
  sectors,
  shortlists,
} from "../db/schema.js";
import { effectiveCompanies } from "./effective.js";
import { DomainError } from "./errors.js";
import type { CompanyListItem } from "./companies.js";
import { renderValue } from "./research/reads.js";

export const SCREEN_OPS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "exists",
  "not_exists",
] as const;

export type ScreenOp = (typeof SCREEN_OPS)[number];

export interface ScreenCriterion {
  field?: string;
  factKey?: string;
  qualifiers?: Record<string, unknown>;
  op: ScreenOp;
  value?: unknown;
}

export interface ScreenSort {
  field?: string;
  factKey?: string;
  order?: "asc" | "desc";
}

export interface ScreenOptions {
  criteria?: ScreenCriterion[];
  sort?: ScreenSort;
  limit?: number;
  /** Strict: fact criteria match only verified facts (default matches verified + doc_only). */
  verifiedOnly?: boolean;
  /** Show unverified and mismatched facts too (default false). Overrides verifiedOnly. */
  includeUnverified?: boolean;
}

/** Which fact verdicts a factKey criterion (and its matched values) may see. */
type FactVerificationFilter = "grounded" | "verified" | "all";

function verificationFilterFor(options: Pick<ScreenOptions, "verifiedOnly" | "includeUnverified">): FactVerificationFilter {
  if (options.includeUnverified) return "all";
  if (options.verifiedOnly) return "verified";
  return "grounded";
}

export interface ScreenItem extends CompanyListItem {
  /** Matched values per criterion, keyed by criterion index. Absence matches yield []. */
  matched: Record<string, unknown[]>;
}

export interface ScreenResult {
  items: ScreenItem[];
  ids: string[];
  total: number;
}

type FieldKind = "text" | "int" | "numeric" | "bool";

const FIELD_KINDS: Record<string, FieldKind> = {
  name: "text",
  domain: "text",
  website: "text",
  country: "text",
  city: "text",
  industry: "text",
  source: "text",
  employees: "int",
  foundedYear: "int",
  annualRevenue: "numeric",
  totalFunding: "numeric",
  sharedDomain: "bool",
};

export const SCREEN_FIELDS = Object.keys(FIELD_KINDS);

export const SCREEN_LIMIT_MAX = 500;
export const SCREEN_CRITERIA_MAX = 20;

function inList(values: (string | number | boolean)[]): SQL {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

function isOp(op: unknown): op is ScreenOp {
  return typeof op === "string" && (SCREEN_OPS as readonly string[]).includes(op);
}

function normalizedQualifiers(input: Record<string, unknown> | undefined, label: string): Record<string, string> {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DomainError("invalid_input", `${label}: qualifiers must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "string") out[name] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[name] = String(value);
    else throw new DomainError("invalid_input", `${label}: qualifier "${name}" must be a string`);
  }
  return out;
}

function checkFieldValue(field: string, kind: FieldKind, op: ScreenOp, value: unknown): void {
  const label = `field "${field}"`;
  if (op === "exists" || op === "not_exists") {
    if (value !== undefined) throw new DomainError("invalid_input", `${label}: ${op} takes no value`);
    return;
  }
  if (value === undefined) throw new DomainError("invalid_input", `${label}: ${op} needs a value`);
  if (op === "in") {
    if (!Array.isArray(value) || value.length === 0) {
      throw new DomainError("invalid_input", `${label}: in needs a non-empty array`);
    }
  }
  const samples = op === "in" ? (value as unknown[]) : [value];
  for (const sample of samples) {
    switch (kind) {
      case "text":
        if (typeof sample !== "string") {
          throw new DomainError("invalid_input", `${label}: expected a string, got ${typeof sample}`);
        }
        if (field === "source" && sample !== "apollo" && sample !== "manual") {
          throw new DomainError("invalid_input", `${label}: expected "apollo" or "manual"`);
        }
        if (op !== "eq" && op !== "ne" && op !== "in") {
          throw new DomainError("invalid_input", `${label}: text fields take eq, ne, in, exists, not_exists`);
        }
        break;
      case "int":
        if (typeof sample !== "number" || !Number.isFinite(sample)) {
          throw new DomainError("invalid_input", `${label}: expected a number, got ${typeof sample}`);
        }
        break;
      case "numeric":
        if (typeof sample !== "number" || !Number.isFinite(sample)) {
          throw new DomainError("invalid_input", `${label}: expected a number, got ${typeof sample}`);
        }
        break;
      case "bool":
        if (typeof sample !== "boolean") {
          throw new DomainError("invalid_input", `${label}: expected true or false, got ${typeof sample}`);
        }
        if (op !== "eq" && op !== "ne" && op !== "in") {
          throw new DomainError("invalid_input", `${label}: bool fields take eq, ne, in, exists, not_exists`);
        }
        break;
    }
  }
}

function fieldPredicate(col: SQL, field: string, kind: FieldKind, op: ScreenOp, value: unknown): SQL {
  switch (op) {
    case "exists":
      return sql`${col} IS NOT NULL`;
    case "not_exists":
      return sql`${col} IS NULL`;
    case "eq":
      return sql`${col} = ${value as string | number | boolean}`;
    case "ne":
      return sql`${col} <> ${value as string | number | boolean}`;
    case "gt":
      return sql`${col} > ${value as number}`;
    case "gte":
      return sql`${col} >= ${value as number}`;
    case "lt":
      return sql`${col} < ${value as number}`;
    case "lte":
      return sql`${col} <= ${value as number}`;
    case "in":
      return sql`${col} IN ${inList(value as (string | number | boolean)[])}`;
  }
}

type FactScalar = "bool" | "number" | "string";

function scalarOf(value: unknown): FactScalar | null {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "string") return "string";
  return null;
}

function checkFactValue(factKey: string, op: ScreenOp, value: unknown): FactScalar | null {
  const label = `fact "${factKey}"`;
  if (op === "exists" || op === "not_exists") {
    if (value !== undefined) throw new DomainError("invalid_input", `${label}: ${op} takes no value`);
    return null;
  }
  if (value === undefined) throw new DomainError("invalid_input", `${label}: ${op} needs a value`);
  if (op === "in") {
    if (!Array.isArray(value) || value.length === 0) {
      throw new DomainError("invalid_input", `${label}: in needs a non-empty array`);
    }
    const kinds = value.map(scalarOf);
    if (kinds.includes(null) || new Set(kinds).size !== 1) {
      throw new DomainError("invalid_input", `${label}: in needs same-type strings, numbers or booleans`);
    }
    return kinds[0] as FactScalar;
  }
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    if (scalarOf(value) !== "number") {
      throw new DomainError("invalid_input", `${label}: ${op} needs a number`);
    }
    return "number";
  }
  const kind = scalarOf(value);
  if (!kind) {
    throw new DomainError("invalid_input", `${label}: ${op} needs a string, number or boolean`);
  }
  return kind;
}

// The compared representation: value_bool, value_num, or value_text with
// value_date as fallback (so date facts match their YYYY-MM-DD string).
function factColumn(kind: FactScalar): SQL {
  if (kind === "bool") return sql`fc.value_bool`;
  if (kind === "number") return sql`fc.value_num`;
  return sql`COALESCE(fc.value_text, fc.value_date::text)`;
}

function factPredicate(
  companyId: SQL,
  factKey: string,
  qualifiers: Record<string, string>,
  op: ScreenOp,
  value: unknown,
  scalar: FactScalar | null,
  verification: FactVerificationFilter,
): SQL {
  const conds: SQL[] = [sql`fc.company_id = ${companyId}`, sql`fc.key = ${factKey}`];
  if (verification === "verified") conds.push(sql`fc.verification = 'verified'`);
  else if (verification === "grounded") conds.push(sql`fc.verification IN ('verified', 'doc_only')`);
  if (Object.keys(qualifiers).length > 0) {
    conds.push(sql`fc.qualifiers @> ${JSON.stringify(qualifiers)}::jsonb`);
  }
  if (scalar && op !== "exists" && op !== "not_exists") {
    const col = factColumn(scalar);
    if (op === "in") {
      conds.push(sql`${col} IN ${inList(value as (string | number | boolean)[])}`);
    } else if (op === "eq") {
      conds.push(sql`${col} = ${value as string | number | boolean}`);
    } else if (op === "ne") {
      conds.push(sql`${col} <> ${value as string | number | boolean}`);
    } else if (op === "gt") {
      conds.push(sql`${col} > ${value as number}`);
    } else if (op === "gte") {
      conds.push(sql`${col} >= ${value as number}`);
    } else if (op === "lt") {
      conds.push(sql`${col} < ${value as number}`);
    } else {
      conds.push(sql`${col} <= ${value as number}`);
    }
  }
  const exists = sql`EXISTS (SELECT 1 FROM facts_current fc WHERE ${sql.join(conds, sql` AND `)})`;
  return op === "not_exists" ? sql`NOT (${exists})` : exists;
}

function criterionPredicate(
  e: ReturnType<typeof effectiveCompanies>,
  criterion: ScreenCriterion,
  index: number,
  verification: FactVerificationFilter,
): SQL {
  const label = `criterion ${index}`;
  if (!isOp(criterion.op)) throw new DomainError("invalid_input", `${label}: unknown op ${String(criterion.op)}`);
  const hasField = criterion.field !== undefined;
  const hasKey = criterion.factKey !== undefined;
  if (hasField === hasKey) {
    throw new DomainError("invalid_input", `${label}: exactly one of field or factKey is required`);
  }
  if (hasField) {
    const field = criterion.field as string;
    const kind = FIELD_KINDS[field];
    if (!kind) {
      throw new DomainError("invalid_input", `${label}: unknown field "${field}" (see ${SCREEN_FIELDS.join(", ")})`);
    }
    if (criterion.qualifiers !== undefined) {
      throw new DomainError("invalid_input", `${label}: qualifiers apply to factKey criteria only`);
    }
    checkFieldValue(field, kind, criterion.op, criterion.value);
    const col = (e as unknown as Record<string, SQL>)[field];
    return fieldPredicate(col, field, kind, criterion.op, criterion.value);
  }
  const factKey = criterion.factKey as string;
  if (factKey.trim() === "") throw new DomainError("invalid_input", `${label}: factKey must not be empty`);
  const qualifiers = normalizedQualifiers(
    criterion.qualifiers as Record<string, unknown> | undefined,
    `${label} fact "${factKey}"`,
  );
  const scalar = checkFactValue(factKey, criterion.op, criterion.value);
  return factPredicate(e.id as unknown as SQL, factKey, qualifiers, criterion.op, criterion.value, scalar, verification);
}

function factSortColumn(valueType: string, factKey: string): SQL {
  switch (valueType) {
    case "number":
    case "percent":
      return sql`fc.value_num`;
    case "money":
      return sql`(fc.value_json->>'amount')::numeric`;
    case "date":
      return sql`fc.value_date`;
    case "bool":
      return sql`fc.value_bool`;
    case "text":
    case "url":
      return sql`fc.value_text`;
    default:
      throw new DomainError("invalid_input", `fact "${factKey}" holds ${valueType} values, which cannot sort`);
  }
}

async function sortOrderBy(
  db: Db,
  e: ReturnType<typeof effectiveCompanies>,
  sort: ScreenSort | undefined,
): Promise<SQL> {
  const order = sort?.order ?? "asc";
  if (order !== "asc" && order !== "desc") {
    throw new DomainError("invalid_input", `unknown order: ${String(sort?.order)}`);
  }
  const direction = order === "asc" ? sql`ASC` : sql`DESC`;
  const field = sort?.field;
  const factKey = sort?.factKey;
  if (field !== undefined && factKey !== undefined) {
    throw new DomainError("invalid_input", "sort takes exactly one of field or factKey");
  }
  if (factKey !== undefined) {
    if (factKey.trim() === "") throw new DomainError("invalid_input", "sort factKey must not be empty");
    const [def] = await db
      .select({ valueType: factKeys.valueType })
      .from(factKeys)
      .where(eq(factKeys.key, factKey));
    if (!def) throw new DomainError("invalid_input", `unknown fact key "${factKey}"`);
    const col = factSortColumn(def.valueType, factKey);
    const scalar = sql`(SELECT ${col} FROM facts_current fc WHERE fc.company_id = ${e.id} AND fc.key = ${factKey} ORDER BY fc.created_at DESC, fc.id DESC LIMIT 1)`;
    return sql`${scalar} ${direction} NULLS LAST, ${e.id} ASC`;
  }
  const name = field ?? "name";
  if (!FIELD_KINDS[name]) {
    throw new DomainError("invalid_input", `unknown sort field "${name}" (see ${SCREEN_FIELDS.join(", ")})`);
  }
  const col = (e as unknown as Record<string, SQL>)[name];
  return sql`${col} ${direction} NULLS LAST, ${e.id} ASC`;
}

interface FactRow {
  companyId: string;
  key: string;
  valueType: string;
  valueNum: string | null;
  valueText: string | null;
  valueDate: string | null;
  valueBool: boolean | null;
  valueJson: unknown;
  qualifiers: Record<string, string>;
}

function representation(row: FactRow, kind: FactScalar): string | number | boolean | null {
  if (kind === "bool") return row.valueBool;
  if (kind === "number") return row.valueNum === null ? null : Number(row.valueNum);
  return row.valueText ?? row.valueDate;
}

// JS mirror of the SQL value predicate, for the matched values only.
function rowMatchesScalar(row: FactRow, op: ScreenOp, value: unknown, scalar: FactScalar): boolean {
  if (op === "exists") return true;
  const rep = representation(row, scalar);
  if (rep === null) return false;
  switch (op) {
    case "eq":
      return rep === (value as string | number | boolean);
    case "ne":
      return rep !== (value as string | number | boolean);
    case "gt":
      return (rep as number) > (value as number);
    case "gte":
      return (rep as number) >= (value as number);
    case "lt":
      return (rep as number) < (value as number);
    case "lte":
      return (rep as number) <= (value as number);
    case "in":
      return (value as (string | number | boolean)[]).includes(rep);
    default:
      return false;
  }
}

function qualifiersSubset(row: FactRow, want: Record<string, string>): boolean {
  const have = row.qualifiers ?? {};
  return Object.entries(want).every(([k, v]) => have[k] === v);
}

/**
 * Screen the live companies of a sector on Apollo fields plus current facts,
 * in SQL. Criteria AND together; a fact criterion matches a company when any
 * current row for the key (plus qualifier subset) satisfies the op. factKey
 * sort uses the latest current row. Unknown fact keys match nothing (they are
 * not registry lookups); unknown sort keys are rejected.
 */
export async function screenCompanies(
  db: Db,
  sectorId: string,
  options: ScreenOptions = {},
): Promise<ScreenResult> {
  const [sector] = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, sectorId));
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  const criteria = options.criteria ?? [];
  if (criteria.length > SCREEN_CRITERIA_MAX) {
    throw new DomainError("invalid_input", `at most ${SCREEN_CRITERIA_MAX} criteria`);
  }
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > SCREEN_LIMIT_MAX) {
    throw new DomainError("invalid_input", `limit must be between 1 and ${SCREEN_LIMIT_MAX}`);
  }

  const e = effectiveCompanies(db);
  const verification = verificationFilterFor(options);
  const conds: SQL[] = [eq(sectorCompanies.sectorId, sectorId), isNull(sectorCompanies.removedAt)];
  criteria.forEach((criterion, index) => conds.push(criterionPredicate(e, criterion, index, verification)));
  const where = and(...conds);
  const orderBy = await sortOrderBy(db, e, options.sort);

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
    .limit(limit);
  const counted = await db
    .select({ n: count().mapWith(Number) })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(where);
  const total = counted[0]?.n ?? 0;

  const factUses = criteria
    .map((criterion, index) => ({ criterion, index }))
    .filter(({ criterion }) => criterion.factKey !== undefined);
  const byCompany = new Map<string, FactRow[]>();
  if (factUses.length > 0 && rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const keys = [...new Set(factUses.map(({ criterion }) => criterion.factKey as string))];
    const factRows = await db
      .select({
        companyId: factsCurrent.companyId,
        key: factsCurrent.key,
        valueType: factKeys.valueType,
        valueNum: factsCurrent.valueNum,
        valueText: factsCurrent.valueText,
        valueDate: factsCurrent.valueDate,
        valueBool: factsCurrent.valueBool,
        valueJson: factsCurrent.valueJson,
        qualifiers: factsCurrent.qualifiers,
      })
      .from(factsCurrent)
      .innerJoin(factKeys, eq(factsCurrent.key, factKeys.key))
      .where(
        and(
          inArray(factsCurrent.companyId, ids),
          inArray(factsCurrent.key, keys),
          ...(verification === "all"
            ? []
            : verification === "verified"
              ? [eq(factsCurrent.verification, "verified" as const)]
              : [inArray(factsCurrent.verification, ["verified", "doc_only"])]),
        ),
      )
      .orderBy(desc(factsCurrent.createdAt), desc(factsCurrent.id));
    for (const row of factRows) {
      const list = byCompany.get(row.companyId) ?? [];
      list.push(row as FactRow);
      byCompany.set(row.companyId, list);
    }
  }

  const items: ScreenItem[] = rows.map((r) => {
    const matched: Record<string, unknown[]> = {};
    criteria.forEach((criterion, index) => {
      if (criterion.op === "not_exists") {
        matched[String(index)] = [];
        return;
      }
      if (criterion.field !== undefined) {
        matched[String(index)] = [(r as unknown as Record<string, unknown>)[criterion.field] ?? null];
        return;
      }
      const qualifiers = normalizedQualifiers(
        criterion.qualifiers as Record<string, unknown> | undefined,
        `criterion ${index}`,
      );
      const scalar =
        criterion.op === "exists"
          ? null
          : (Array.isArray(criterion.value)
              ? scalarOf((criterion.value as unknown[])[0])
              : scalarOf(criterion.value));
      const candidates = (byCompany.get(r.id) ?? []).filter(
        (row) => row.key === criterion.factKey && qualifiersSubset(row, qualifiers),
      );
      matched[String(index)] =
        scalar === null
          ? candidates.map((row) => renderValue(row.valueType, row))
          : candidates
              .filter((row) => rowMatchesScalar(row, criterion.op, criterion.value, scalar))
              .map((row) => renderValue(row.valueType, row));
    });
    return {
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
      matched,
    };
  });
  return { items, ids: items.map((item) => item.id), total };
}

export interface JobScopeOptions {
  criteria?: ScreenCriterion[];
  sort?: ScreenSort;
}

/**
 * Unbounded company-id resolution for bulk jobs: the same criteria and
 * sort semantics as screenCompanies, but ids only and no 500 cap. Jobs
 * default to employees desc; shortlist scope keeps the list order.
 */
export async function screenJobCompanyIds(
  db: Db,
  sectorId: string,
  options: JobScopeOptions = {},
): Promise<string[]> {
  const [sector] = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, sectorId));
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  const criteria = options.criteria ?? [];
  if (criteria.length > SCREEN_CRITERIA_MAX) {
    throw new DomainError("invalid_input", `at most ${SCREEN_CRITERIA_MAX} criteria`);
  }
  const e = effectiveCompanies(db);
  const conds: SQL[] = [eq(sectorCompanies.sectorId, sectorId), isNull(sectorCompanies.removedAt)];
  criteria.forEach((criterion, index) => conds.push(criterionPredicate(e, criterion, index, "all")));
  const orderBy = await sortOrderBy(db, e, options.sort ?? { field: "employees", order: "desc" });
  const rows = await db
    .select({ id: e.id })
    .from(e)
    .innerJoin(sectorCompanies, eq(sectorCompanies.companyId, e.id))
    .where(and(...conds))
    .orderBy(orderBy);
  return rows.map((r) => r.id);
}

export interface ShortlistSaveInput {
  sectorId: string;
  name: string;
  companyIds: string[];
  criteria?: unknown[] | null;
  createdBy?: string;
}

export interface ShortlistView {
  id: string;
  sectorId: string;
  name: string;
  companyIds: string[];
  criteria: unknown[] | null;
  createdBy: string;
  createdAt: Date;
}

function toShortlistView(row: typeof shortlists.$inferSelect): ShortlistView {
  return {
    id: row.id,
    sectorId: row.sectorId,
    name: row.name,
    companyIds: row.companyIds,
    criteria: row.criteria ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Save (insert or replace by sector + name) a named company shortlist. */
export async function saveShortlist(db: Db, input: ShortlistSaveInput): Promise<ShortlistView> {
  const [sector] = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, input.sectorId));
  if (!sector) throw new DomainError("not_found", `sector not found: ${input.sectorId}`);
  const name = input.name?.trim() ?? "";
  if (name === "") throw new DomainError("invalid_input", "shortlist name is required");
  if (name.length > 200) throw new DomainError("invalid_input", "shortlist name is at most 200 chars");
  if (!Array.isArray(input.companyIds)) {
    throw new DomainError("invalid_input", "companyIds must be an array");
  }
  const unique = [...new Set(input.companyIds)];
  if (unique.length > 0) {
    const members = await db
      .select({ companyId: sectorCompanies.companyId })
      .from(sectorCompanies)
      .where(and(eq(sectorCompanies.sectorId, input.sectorId), inArray(sectorCompanies.companyId, unique)));
    const have = new Set(members.map((m) => m.companyId));
    const missing = unique.filter((id) => !have.has(id));
    if (missing.length > 0) {
      throw new DomainError("invalid_input", `unknown or out-of-sector companies: ${missing.join(", ")}`);
    }
  }
  if (input.criteria !== undefined && input.criteria !== null && !Array.isArray(input.criteria)) {
    throw new DomainError("invalid_input", "criteria must be an array");
  }
  const createdBy = input.createdBy ?? "owner";
  const [row] = await db
    .insert(shortlists)
    .values({
      id: randomUUID(),
      sectorId: input.sectorId,
      name,
      companyIds: unique,
      criteria: (input.criteria ?? null) as unknown[] | null,
      createdBy,
    })
    .onConflictDoUpdate({
      target: [shortlists.sectorId, shortlists.name],
      set: {
        companyIds: unique,
        criteria: (input.criteria ?? null) as unknown[] | null,
        createdBy,
      },
    })
    .returning();
  if (!row) throw new Error("shortlist upsert returned no row");
  return toShortlistView(row);
}

export async function getShortlist(db: Db, sectorId: string, name: string): Promise<ShortlistView> {
  const [row] = await db
    .select()
    .from(shortlists)
    .where(and(eq(shortlists.sectorId, sectorId), eq(shortlists.name, name)));
  if (!row) throw new DomainError("not_found", `shortlist not found: ${name}`);
  return toShortlistView(row);
}

export interface ShortlistSummary {
  name: string;
  companyCount: number;
  createdAt: Date;
}

export async function listShortlists(db: Db, sectorId: string): Promise<ShortlistSummary[]> {
  const [sector] = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, sectorId));
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  const rows = await db
    .select({ name: shortlists.name, companyIds: shortlists.companyIds, createdAt: shortlists.createdAt })
    .from(shortlists)
    .where(eq(shortlists.sectorId, sectorId))
    .orderBy(shortlists.name);
  return rows.map((r) => ({ name: r.name, companyCount: r.companyIds.length, createdAt: r.createdAt }));
}
