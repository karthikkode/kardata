import { gunzipSync } from "node:zlib";
import { pdfText } from "../../lib/sec/pdf-text.js";
import { load } from "cheerio";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  area,
  areaStatuses,
  blobs,
  companies,
  documents,
  factKeys,
  facts,
  factsCurrent,
  findings,
  records,
  recordTypes,
  researchRuns,
  runEvents,
  sources,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";

export function extractText(html: string): string {
  const $ = load(html);
  $("script, style, noscript, template, svg").remove();
  const body = $("body").length > 0 ? $("body").text() : $.root().text();
  return body.replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export interface RenderedFact {
  id: string;
  key: string;
  area: string | null;
  type: string;
  value: unknown;
  currency: string | null;
  unit: string | null;
  qualifiers: Record<string, string>;
  asOf: string | null;
  confidence: string;
  note: string | null;
  tags: string[];
  sourceIds: string[];
  runId: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface RenderValueRow {
  valueNum: string | null;
  valueText: string | null;
  valueDate: string | null;
  valueBool: boolean | null;
  valueJson: unknown;
}

export function renderValue(type: string, row: RenderValueRow): unknown {
  switch (type) {
    case "number":
    case "percent":
      return row.valueNum === null ? null : Number(row.valueNum);
    case "money":
      return (row.valueJson as { amount?: number } | null)?.amount ?? null;
    case "date":
      return row.valueDate;
    case "bool":
      return row.valueBool;
    case "text":
    case "url":
      return row.valueText;
    case "text_list":
    case "json":
      return row.valueJson;
    default:
      return null;
  }
}

async function requireCompany(db: Db, companyId: string): Promise<void> {
  const [row] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!row) throw new DomainError("not_found", `company not found: ${companyId}`);
}

export interface GetFactsInput {
  companyId: string;
  keys?: string[];
  history?: boolean;
  limit?: number;
}

export async function getFacts(db: Db, input: GetFactsInput): Promise<RenderedFact[]> {
  await requireCompany(db, input.companyId);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const keyFilter =
    input.keys && input.keys.length > 0 ? inArray(facts.key, input.keys) : undefined;
  const currentFilter =
    input.keys && input.keys.length > 0 ? inArray(factsCurrent.key, input.keys) : undefined;
  if (input.history) {
    const rows = await db
      .select({ fact: facts, valueType: factKeys.valueType })
      .from(facts)
      .innerJoin(factKeys, eq(facts.key, factKeys.key))
      .where(and(eq(facts.companyId, input.companyId), keyFilter))
      .orderBy(desc(facts.createdAt), desc(facts.id))
      .limit(limit);
    return rows.map(({ fact, valueType }) => toRendered(fact, valueType));
  }
  const rows = await db
    .select({
      id: factsCurrent.id,
      companyId: factsCurrent.companyId,
      runId: factsCurrent.runId,
      key: factsCurrent.key,
      area: factsCurrent.area,
      valueType: factKeys.valueType,
      valueNum: factsCurrent.valueNum,
      valueText: factsCurrent.valueText,
      valueDate: factsCurrent.valueDate,
      valueBool: factsCurrent.valueBool,
      valueJson: factsCurrent.valueJson,
      currency: factsCurrent.currency,
      qualifiers: factsCurrent.qualifiers,
      asOf: factsCurrent.asOf,
      sourceIds: factsCurrent.sourceIds,
      confidence: factsCurrent.confidence,
      createdBy: factsCurrent.createdBy,
      createdAt: factsCurrent.createdAt,
    })
    .from(factsCurrent)
    .innerJoin(factKeys, eq(factsCurrent.key, factKeys.key))
    .where(and(eq(factsCurrent.companyId, input.companyId), currentFilter))
    .orderBy(factsCurrent.key);
  return rows.slice(0, limit).map((row) => toRendered(row, row.valueType));
}

function toRendered(
  fact: {
    id: string;
    key: string;
    area: string | null;
    valueNum: string | null;
    valueText: string | null;
    valueDate: string | null;
    valueBool: boolean | null;
    valueJson: unknown;
    currency: string | null;
    unit?: string | null;
    qualifiers: Record<string, string>;
    asOf: string | null;
    confidence: "low" | "medium" | "high";
    note?: string | null;
    tags?: string[];
    sourceIds: string[];
    runId: string | null;
    createdBy: string;
    createdAt: Date;
  },
  valueType: string,
): RenderedFact {
  return {
    id: fact.id,
    key: fact.key,
    area: fact.area,
    type: valueType,
    value: renderValue(valueType, fact),
    currency: fact.currency,
    unit: fact.unit ?? null,
    qualifiers: fact.qualifiers,
    asOf: fact.asOf,
    confidence: fact.confidence,
    note: fact.note ?? null,
    tags: fact.tags ?? [],
    sourceIds: fact.sourceIds,
    runId: fact.runId,
    createdBy: fact.createdBy,
    createdAt: fact.createdAt,
  };
}

export interface ListRecordsInput {
  companyId: string;
  type: string;
  query?: string;
  limit?: number;
}

export async function listRecords(db: Db, input: ListRecordsInput) {
  await requireCompany(db, input.companyId);
  const [def] = await db.select().from(recordTypes).where(eq(recordTypes.name, input.type));
  if (!def) return [];
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const scope = and(eq(records.companyId, input.companyId), eq(records.type, input.type));
  if (input.query && input.query.trim() !== "") {
    const q = sql`plainto_tsquery('english', ${input.query})`;
    return db
      .select({
        id: records.id,
        type: records.type,
        area: records.area,
        data: records.data,
        sourceIds: records.sourceIds,
        tags: records.tags,
        updatedAt: records.updatedAt,
        rank: sql<number>`ts_rank(${records.tsv}, ${q})`,
      })
      .from(records)
      .where(and(scope, sql`${records.tsv} @@ ${q}`))
      .orderBy(sql`ts_rank(${records.tsv}, ${q}) DESC`)
      .limit(limit);
  }
  return db
    .select({
      id: records.id,
      type: records.type,
      area: records.area,
      data: records.data,
      sourceIds: records.sourceIds,
      tags: records.tags,
      updatedAt: records.updatedAt,
    })
    .from(records)
    .where(scope)
    .orderBy(desc(records.updatedAt))
    .limit(limit);
}

export interface SearchInput {
  query: string;
  companyId?: string;
  kinds?: ("document" | "record" | "fact" | "source")[];
  area?: string;
  tags?: string[];
  limit?: number;
}

export interface SearchHit {
  kind: string;
  id: string;
  companyId: string;
  area: string | null;
  title: string;
  headline: string;
  rank: number;
}

export async function searchAll(db: Db, input: SearchInput): Promise<SearchHit[]> {
  if (input.query.trim() === "") return [];
  if (input.companyId) await requireCompany(db, input.companyId);
  if (input.area !== undefined && !(area.enumValues as readonly string[]).includes(input.area)) {
    throw new DomainError("invalid_input", `unknown area "${input.area}"`);
  }
  const kinds = input.kinds ?? ["document", "record", "fact", "source"];
  for (const kind of kinds) {
    if (!["document", "record", "fact", "source"].includes(kind)) {
      throw new DomainError("invalid_input", `unknown kind "${kind}"`);
    }
  }
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const q = sql`plainto_tsquery('english', ${input.query})`;
  const companyFilter = (table: { companyId: unknown }) =>
    input.companyId ? sql`AND ${table.companyId} = ${input.companyId}` : sql``;
  const areaFilter = (col: unknown) => (input.area ? sql`AND ${col} = ${input.area}` : sql``);
  const tagsFilter = (col: unknown) =>
    input.tags && input.tags.length > 0 ? sql`AND ${col} @> ${input.tags}` : sql``;

  const branches: ReturnType<typeof sql>[] = [];
  if (kinds.includes("document")) {
    branches.push(sql`
      SELECT 'document' AS kind, id::text AS id, company_id::text AS company_id, area,
        title, ts_headline('english', content_md, ${q}, 'MaxWords=30, MaxFragments=2') AS headline,
        ts_rank(tsv, ${q}) AS rank
      FROM documents
      WHERE tsv @@ ${q} AND is_current ${companyFilter(documents)} ${areaFilter(documents.area)} ${tagsFilter(documents.tags)}`);
  }
  if (kinds.includes("record")) {
    branches.push(sql`
      SELECT 'record' AS kind, id::text AS id, company_id::text AS company_id, area,
        COALESCE(data->>'title', data->>'name', type) AS title,
        ts_headline('english', data::text, ${q}, 'MaxWords=30, MaxFragments=2') AS headline,
        ts_rank(tsv, ${q}) AS rank
      FROM records
      WHERE tsv @@ ${q} ${companyFilter(records)} ${areaFilter(records.area)} ${tagsFilter(records.tags)}`);
  }
  if (kinds.includes("fact")) {
    branches.push(sql`
      SELECT 'fact' AS kind, facts.id::text AS id, facts.company_id::text AS company_id, facts.area,
        facts.key AS title,
        ts_headline('english', facts.key || ' ' || COALESCE(facts.value_text, ''), ${q}, 'MaxWords=30, MaxFragments=2') AS headline,
        ts_rank(facts.tsv, ${q}) AS rank
      FROM facts
      WHERE facts.tsv @@ ${q} ${companyFilter(facts)} ${areaFilter(facts.area)} ${tagsFilter(facts.tags)}`);
  }
  if (kinds.includes("source") && !input.area && !(input.tags && input.tags.length > 0)) {
    branches.push(sql`
      SELECT 'source' AS kind, id::text AS id, company_id::text AS company_id, NULL::area AS area,
        url AS title,
        ts_headline('english', url || ' ' || COALESCE(error, ''), ${q}, 'MaxWords=30, MaxFragments=2') AS headline,
        ts_rank(tsv, ${q}) AS rank
      FROM sources
      WHERE tsv @@ ${q} ${companyFilter(sources)}`);
  }
  if (branches.length === 0) return [];
  const union = branches.reduce((acc, branch) => sql`${acc} UNION ALL ${branch}`);
  const rows = await db.execute<{ kind: string; id: string; companyId: string; area: string | null; title: string; headline: string; rank: number }>(
    sql`${union} ORDER BY rank DESC LIMIT ${limit}`,
  );
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    companyId: r.companyId,
    area: r.area,
    title: r.title,
    headline: r.headline,
    rank: Number(r.rank),
  }));
}

export interface CompanyContext {
  company: { id: string; name: string | null };
  facts: { key: string; value: unknown; currency: string | null; qualifiers: Record<string, string>; asOf: string | null; confidence: string }[];
  recordCounts: { type: string; count: number }[];
  documents: { path: string; title: string; kind: string; area: string | null; version: number; size: number; createdAt: Date }[];
  findings: { id: string; area: string; claim: string; status: string; confidence: string }[];
  areaStatuses: { area: string; status: string; reason: string | null; runId: string }[];
}

export interface CompanyContextOptions {
  /** Show unverified and mismatched facts, records and findings too (default false). */
  includeUnverified?: boolean;
}

const GROUNDED = ["verified", "doc_only", "verified_value"] as const;

export async function getCompanyContext(
  db: Db,
  companyId: string,
  options: CompanyContextOptions = {},
): Promise<CompanyContext> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${companyId}`);
  const groundedOnly = !options.includeUnverified;

  const factRows = await db
    .select({
      key: factsCurrent.key,
      valueType: factKeys.valueType,
      valueNum: factsCurrent.valueNum,
      valueText: factsCurrent.valueText,
      valueDate: factsCurrent.valueDate,
      valueBool: factsCurrent.valueBool,
      valueJson: factsCurrent.valueJson,
      currency: factsCurrent.currency,
      qualifiers: factsCurrent.qualifiers,
      asOf: factsCurrent.asOf,
      confidence: factsCurrent.confidence,
    })
    .from(factsCurrent)
    .innerJoin(factKeys, eq(factsCurrent.key, factKeys.key))
    .where(
      groundedOnly
        ? and(eq(factsCurrent.companyId, companyId), inArray(factsCurrent.verification, [...GROUNDED]))
        : eq(factsCurrent.companyId, companyId),
    )
    .orderBy(factsCurrent.key)
    .limit(200);

  const countRows = await db
    .select({ type: records.type, count: sql<number>`count(*)::int` })
    .from(records)
    .where(
      groundedOnly
        ? and(eq(records.companyId, companyId), inArray(records.verification, [...GROUNDED]))
        : eq(records.companyId, companyId),
    )
    .groupBy(records.type);

  const docRows = await db
    .select({
      path: documents.path,
      title: documents.title,
      kind: documents.kind,
      area: documents.area,
      version: documents.version,
      size: sql<number>`length(${documents.contentMd})`,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.isCurrent, true)))
    .orderBy(documents.path)
    .limit(200);

  const findingRows = await db
    .select({
      id: findings.id,
      area: findings.area,
      claim: findings.claim,
      status: findings.status,
      confidence: findings.confidence,
    })
    .from(findings)
    .where(
      groundedOnly
        ? and(eq(findings.companyId, companyId), inArray(findings.verification, [...GROUNDED]))
        : eq(findings.companyId, companyId),
    )
    .orderBy(desc(findings.createdAt))
    .limit(50);

  const statusRows = await db.execute<{ area: string; status: string; reason: string | null; run_id: string }>(sql`
    SELECT DISTINCT ON (s.area) s.area, s.status, s.reason, s.run_id
    FROM area_statuses s JOIN research_runs r ON r.id = s.run_id
    WHERE s.company_id = ${companyId}
    ORDER BY s.area, r.created_at DESC`);

  return {
    company,
    facts: factRows.map((fact) => ({
      key: fact.key,
      value: renderValue(fact.valueType, fact),
      currency: fact.currency,
      qualifiers: fact.qualifiers as Record<string, string>,
      asOf: fact.asOf,
      confidence: fact.confidence,
    })),
    recordCounts: countRows,
    documents: docRows.map((d) => ({ ...d, path: d.path ?? "(no path)" })),
    findings: findingRows,
    areaStatuses: statusRows.map((r) => ({ area: r.area, status: r.status, reason: r.reason, runId: r.run_id })),
  };
}

export interface Dossier {
  company: { id: string; name: string | null };
  statuses: { area: string; status: string; reason: string | null; runId: string }[];
  documents: { area: string; docs: { id: string; title: string; size: number }[] }[];
  findingCounts: { total: number; byStatus: Record<string, number> };
  lastRun: { id: string; kind: string; status: string; createdAt: Date; finishedAt: Date | null } | null;
}

export async function getDossier(db: Db, companyId: string): Promise<Dossier> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${companyId}`);

  const statusRows = await db.execute<{ area: string; status: string; reason: string | null; run_id: string }>(sql`
    SELECT DISTINCT ON (s.area) s.area, s.status, s.reason, s.run_id
    FROM area_statuses s JOIN research_runs r ON r.id = s.run_id
    WHERE s.company_id = ${companyId}
    ORDER BY s.area, r.created_at DESC`);

  const docRows = await db
    .select({
      id: documents.id,
      title: documents.title,
      area: documents.area,
      size: sql<number>`length(${documents.contentMd})`,
    })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.isCurrent, true)))
    .orderBy(documents.path);

  const findingRows = await db
    .select({ status: findings.status, count: sql<number>`count(*)::int` })
    .from(findings)
    .where(eq(findings.companyId, companyId))
    .groupBy(findings.status);

  const [lastRun] = await db
    .select({
      id: researchRuns.id,
      kind: researchRuns.kind,
      status: researchRuns.status,
      createdAt: researchRuns.createdAt,
      finishedAt: researchRuns.finishedAt,
    })
    .from(researchRuns)
    .where(eq(researchRuns.companyId, companyId))
    .orderBy(desc(researchRuns.createdAt))
    .limit(1);

  const byArea = new Map<string, { id: string; title: string; size: number }[]>();
  for (const doc of docRows) {
    const key = doc.area ?? "general";
    const list = byArea.get(key) ?? [];
    list.push({ id: doc.id, title: doc.title, size: doc.size });
    byArea.set(key, list);
  }
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of findingRows) {
    byStatus[row.status] = row.count;
    total += row.count;
  }
  return {
    company,
    statuses: statusRows.map((r) => ({ area: r.area, status: r.status, reason: r.reason, runId: r.run_id })),
    documents: [...byArea.entries()].map(([areaName, docs]) => ({ area: areaName, docs })),
    findingCounts: { total, byStatus },
    lastRun: lastRun ?? null,
  };
}

export async function listDocuments(db: Db, input: { companyId: string; prefix?: string; limit?: number }) {
  await requireCompany(db, input.companyId);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const conditions = [eq(documents.companyId, input.companyId), eq(documents.isCurrent, true)];
  if (input.prefix) conditions.push(sql`${documents.path} LIKE ${`${input.prefix}%`}`);
  return db
    .select({
      id: documents.id,
      path: documents.path,
      title: documents.title,
      kind: documents.kind,
      area: documents.area,
      version: documents.version,
      size: sql<number>`length(${documents.contentMd})`,
      tags: documents.tags,
      createdAt: documents.createdAt,
      createdBy: documents.createdBy,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(documents.path)
    .limit(limit);
}

export async function getDocument(
  db: Db,
  input: { documentId: string; offset?: number; maxChars?: number; companyScope?: string },
) {
  const maxChars = input.maxChars ?? 20000;
  if (maxChars < 1 || maxChars > 20000) throw new DomainError("invalid_input", "maxChars must be 1..20000");
  const offset = input.offset ?? 0;
  if (offset < 0) throw new DomainError("invalid_input", "offset must be >= 0");
  const [doc] = await db.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc) throw new DomainError("not_found", `document not found: ${input.documentId}`);
  if (input.companyScope !== undefined && doc.companyId !== input.companyScope) {
    throw new DomainError("forbidden", "document belongs to another company");
  }
  const sourceUrls =
    doc.sourceIds.length > 0
      ? (
          await db
            .select({ id: sources.id, url: sources.url })
            .from(sources)
            .where(inArray(sources.id, doc.sourceIds))
        ).map((s) => ({ id: s.id, url: s.url }))
      : [];
  return {
    id: doc.id,
    companyId: doc.companyId,
    runId: doc.runId,
    area: doc.area,
    kind: doc.kind,
    title: doc.title,
    path: doc.path,
    version: doc.version,
    isCurrent: doc.isCurrent,
    tags: doc.tags,
    sourceIds: doc.sourceIds,
    factIds: doc.factIds,
    recordIds: doc.recordIds,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    size: doc.contentMd.length,
    content: doc.contentMd.slice(offset, offset + maxChars),
    truncated: doc.contentMd.length > offset + maxChars,
    sourceUrls,
  };
}

export async function getDocumentHistory(db: Db, documentId: string, companyScope?: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new DomainError("not_found", `document not found: ${documentId}`);
  if (companyScope !== undefined && doc.companyId !== companyScope) {
    throw new DomainError("forbidden", "document belongs to another company");
  }
  if (!doc.path) return [];
  return db
    .select({
      id: documents.id,
      version: documents.version,
      isCurrent: documents.isCurrent,
      size: sql<number>`length(${documents.contentMd})`,
      createdBy: documents.createdBy,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.companyId, doc.companyId), eq(documents.path, doc.path)))
    .orderBy(desc(documents.version));
}

export interface WrittenItems {
  facts: number;
  records: number;
  documents: number;
  findings: number;
}

const EMPTY_ITEMS: WrittenItems = { facts: 0, records: 0, documents: 0, findings: 0 };

// Items written by each run. Facts, documents and findings carry run_id;
// records are attributed by the agent created_by prefix (agent:<runId>/...).
export async function itemsForRuns(db: Db, runIds: string[]): Promise<Map<string, WrittenItems>> {
  const result = new Map<string, WrittenItems>(runIds.map((id) => [id, { ...EMPTY_ITEMS }]));
  if (runIds.length === 0) return result;
  const bump = (runId: string | null, key: keyof WrittenItems, count: number): void => {
    if (!runId) return;
    const entry = result.get(runId);
    if (entry) entry[key] += count;
  };
  const factRows = await db
    .select({ runId: facts.runId, count: sql<number>`count(*)::int` })
    .from(facts)
    .where(inArray(facts.runId, runIds))
    .groupBy(facts.runId);
  for (const row of factRows) bump(row.runId, "facts", row.count);
  const docRows = await db
    .select({ runId: documents.runId, count: sql<number>`count(*)::int` })
    .from(documents)
    .where(inArray(documents.runId, runIds))
    .groupBy(documents.runId);
  for (const row of docRows) bump(row.runId, "documents", row.count);
  const findingRows = await db
    .select({ runId: findings.runId, count: sql<number>`count(*)::int` })
    .from(findings)
    .where(inArray(findings.runId, runIds))
    .groupBy(findings.runId);
  for (const row of findingRows) bump(row.runId, "findings", row.count);
  const idList = sql.join(
    runIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const recordRows = await db.execute<{ run_id: string; count: number }>(sql`
    SELECT split_part(split_part(${records.createdBy}, '/', 1), ':', 2) AS run_id,
      COUNT(*)::int AS count
    FROM ${records}
    WHERE ${records.createdBy} LIKE 'agent:%'
      AND split_part(split_part(${records.createdBy}, '/', 1), ':', 2) IN (${idList})
    GROUP BY 1`);
  for (const row of recordRows as unknown as { run_id: string; count: number }[]) {
    bump(row.run_id, "records", Number(row.count));
  }
  return result;
}

export async function getRunDetail(db: Db, runId: string) {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new DomainError("not_found", `run not found: ${runId}`);
  const statuses = await db
    .select({
      area: areaStatuses.area,
      status: areaStatuses.status,
      reason: areaStatuses.reason,
      updatedAt: areaStatuses.updatedAt,
    })
    .from(areaStatuses)
    .where(eq(areaStatuses.runId, runId))
    .orderBy(areaStatuses.area);
  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.runId, runId))
    .orderBy(documents.createdAt);
  const items = await itemsForRuns(db, [runId]);
  return {
    run,
    statuses,
    documentIds: docs.map((d) => d.id),
    items: items.get(runId) ?? { ...EMPTY_ITEMS },
  };
}

export async function listRunEvents(
  db: Db,
  input: { runId: string; afterId?: number; limit?: number },
) {
  const [run] = await db.select({ id: researchRuns.id }).from(researchRuns).where(eq(researchRuns.id, input.runId));
  if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
  const limit = input.limit ?? 200;
  if (limit < 1 || limit > 200) throw new DomainError("invalid_input", "limit must be 1..200");
  const conditions = [eq(runEvents.runId, input.runId)];
  if (input.afterId !== undefined) conditions.push(gt(runEvents.id, input.afterId));
  return db
    .select({ id: runEvents.id, at: runEvents.at, type: runEvents.type, payload: runEvents.payload })
    .from(runEvents)
    .where(and(...conditions))
    .orderBy(runEvents.id)
    .limit(limit);
}

export async function getBatchStatus(db: Db, batchId: string) {
  const rows = await db
    .select({
      runId: researchRuns.id,
      companyId: researchRuns.companyId,
      companyName: companies.name,
      status: researchRuns.status,
      phase: researchRuns.agentPhase,
      promptVersion: researchRuns.promptVersion,
      usage: researchRuns.agentUsage,
      startedAt: researchRuns.startedAt,
      finishedAt: researchRuns.finishedAt,
      createdAt: researchRuns.createdAt,
    })
    .from(researchRuns)
    .innerJoin(companies, eq(researchRuns.companyId, companies.id))
    .where(eq(researchRuns.batchId, batchId))
    .orderBy(companies.name);
  if (rows.length === 0) throw new DomainError("not_found", `batch not found: ${batchId}`);
  const counts: Record<string, number> = {};
  const phases: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    if (row.phase) phases[row.phase] = (phases[row.phase] ?? 0) + 1;
  }
  const now = Date.now();
  const items = await itemsForRuns(
    db,
    rows.map((r) => r.runId),
  );
  return {
    batchId,
    counts,
    phases,
    runs: rows.map((r) => {
      const start = (r.startedAt ?? r.createdAt).getTime();
      const end = (r.finishedAt ?? new Date(now)).getTime();
      return {
        runId: r.runId,
        companyId: r.companyId,
        companyName: r.companyName,
        status: r.status,
        phase: r.phase,
        minutes: Math.round(((end - start) / 60000) * 100) / 100,
        tokens: r.usage ?? null,
        items: items.get(r.runId) ?? { ...EMPTY_ITEMS },
      };
    }),
  };
}

// Agent activity: harness events plus the mcp_call audit trail, oldest first.
export async function listRunActivity(
  db: Db,
  input: { runId: string; afterId?: number; limit?: number },
) {
  const [run] = await db.select({ id: researchRuns.id }).from(researchRuns).where(eq(researchRuns.id, input.runId));
  if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
  const limit = input.limit ?? 200;
  if (limit < 1 || limit > 200) throw new DomainError("invalid_input", "limit must be 1..200");
  const conditions = [eq(runEvents.runId, input.runId), sql`${runEvents.type} IN ('harness', 'mcp_call')`];
  if (input.afterId !== undefined) conditions.push(gt(runEvents.id, input.afterId));
  return db
    .select({ id: runEvents.id, at: runEvents.at, type: runEvents.type, payload: runEvents.payload })
    .from(runEvents)
    .where(and(...conditions))
    .orderBy(runEvents.id)
    .limit(limit);
}

export async function documentSearch(
  db: Db,
  input: { query: string; companyId?: string; area?: string; limit?: number },
) {
  if (input.query.trim() === "") return [];
  if (input.companyId) await requireCompany(db, input.companyId);
  if (input.area !== undefined && !(area.enumValues as readonly string[]).includes(input.area)) {
    throw new DomainError("invalid_input", `unknown area "${input.area}"`);
  }
  const limit = input.limit ?? 50;
  if (limit < 1 || limit > 50) throw new DomainError("invalid_input", "limit must be 1..50");
  const q = sql`plainto_tsquery('english', ${input.query})`;
  const conditions = [sql`${documents.tsv} @@ ${q}`, eq(documents.isCurrent, true)];
  if (input.companyId) conditions.push(eq(documents.companyId, input.companyId));
  if (input.area) conditions.push(eq(documents.area, input.area as (typeof area.enumValues)[number]));
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      path: documents.path,
      area: documents.area,
      headline: sql<string>`ts_headline('english', ${documents.contentMd}, ${q}, 'MaxWords=30, MaxFragments=2')`,
      rank: sql<number>`ts_rank(${documents.tsv}, ${q})`,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(sql`ts_rank(${documents.tsv}, ${q}) DESC`)
    .limit(limit);
  return rows.map((r) => ({ ...r, rank: Number(r.rank), headline: r.headline.slice(0, 200) }));
}

export async function blobText(db: Db, sha256: string): Promise<{ text: string; contentType: string } | null> {
  const [blob] = await db.select().from(blobs).where(eq(blobs.sha256, sha256));
  if (!blob) return null;
  const body = gunzipSync(blob.gzip);
  const contentType = blob.contentType ?? "";
  if (contentType.toLowerCase().includes("application/pdf")) {
    return { text: await pdfText(body), contentType };
  }
  const raw = body.toString("utf8");
  return {
    text: contentType.includes("html") ? extractText(raw) : raw,
    contentType,
  };
}

export async function getSourceExcerpt(db: Db, input: { sourceId: string; maxChars?: number; companyScope?: string }) {
  const maxChars = input.maxChars ?? 5000;
  if (maxChars < 1 || maxChars > 5000) throw new DomainError("invalid_input", "maxChars must be 1..5000");
  const [source] = await db.select().from(sources).where(eq(sources.id, input.sourceId));
  if (!source) throw new DomainError("not_found", `source not found: ${input.sourceId}`);
  if (input.companyScope !== undefined && source.companyId !== input.companyScope) {
    throw new DomainError("forbidden", "source belongs to another company");
  }
  let text: string | null = null;
  let truncated = false;
  if (source.blobSha256) {
    const blob = await blobText(db, source.blobSha256);
    if (blob) {
      text = blob.text.slice(0, maxChars);
      truncated = blob.text.length > maxChars;
    }
  }
  const { blobSha256: _ignored, ...meta } = source;
  void _ignored;
  return { ...meta, text, truncated };
}
