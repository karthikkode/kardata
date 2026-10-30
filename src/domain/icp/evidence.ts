import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, facts, factsCurrent, records, sectorCompanies, sectorPreflight, sources } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { getProfileOrNull } from "../sector-preflight/profile.js";
import { companyRevenueTruth } from "../tiering.js";
import { RIA_SIGNAL_RULES } from "./ria-rules.js";
import { ALL_RULES, type BucketKey, type BucketRule, type Route } from "./rules.js";

/**
 * The ICP evidence pack (Stage 5.5 Step 1): stored facts and records sorted
 * into one bucket per signal, exclusion and flag, after the evidence rules
 * (docs/business/evidence-rules.md) are applied. Deterministic; the judge
 * only ever sees what survives here.
 */

export const BUCKET_ITEM_MAX = 25;
const VALUE_MAX = 300;
const QUOTE_MAX = 300;
const DAY_MS = 86_400_000;

export interface EvidenceFact {
  id: string;
  key: string;
  valueText: string | null;
  valueNum: string | null;
  valueDate: string | null;
  valueBool: boolean | null;
  valueJson: unknown;
  currency: string | null;
  unit: string | null;
  qualifiers: Record<string, string>;
  asOf: string | null;
  sourceIds: string[];
  verification: string;
  quote: string | null;
  createdBy: string;
}

export interface EvidenceRecord {
  id: string;
  type: string;
  data: Record<string, unknown>;
  sourceIds: string[];
  verification: string;
  quote: string | null;
  createdBy: string;
}

export interface EvidenceSource {
  url: string;
  fetchedAt: Date;
}

export interface EvidenceItem {
  /** `f:<uuid>` for a fact, `r:<uuid>` for a record: the id the judge cites. */
  ref: string;
  kind: "fact" | "record";
  key: string;
  value: string;
  quote: string | null;
  url: string | null;
  date: string;
  /** stated = the source gives the date; seen = the day we fetched it. */
  dateKind: "stated" | "seen";
  /**
   * grounded = quote checked (verified, verified_value); collector = read
   * straight from the source; notes = quoted in the agent's notes but not
   * matched to a stored page (doc_only), usable only where a rule allows.
   */
  origin: "grounded" | "collector" | "notes";
}

export interface DroppedCounts {
  unverified: number;
  /** doc_only rows kept out of signal buckets (still usable for exclusions and flags). */
  notesOnly: number;
  undated: number;
  stale: number;
}

export interface PackInput {
  facts: EvidenceFact[];
  records: EvidenceRecord[];
  sources: Map<string, EvidenceSource>;
  now: Date;
}

export type Buckets = Record<string, EvidenceItem[]>;

export interface BuiltPack {
  buckets: Buckets;
  dropped: DroppedCounts;
  /** Distinct usable items across all buckets. */
  usable: number;
}

const RECORD_DATE_FIELDS = ["date", "posted_at", "published_at", "occurred_at", "launched_at"];

/** Grounded rows, collector rows read straight from the source, or research-note rows; never a quote mismatch. */
export function usableOrigin(row: { verification: string; createdBy: string }): EvidenceItem["origin"] | null {
  if (row.verification === "verified" || row.verification === "verified_value") return "grounded";
  if (row.createdBy.startsWith("collector:") && row.verification !== "quote_mismatch") return "collector";
  if (row.verification === "doc_only") return "notes";
  return null;
}

function isoDay(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value !== "string" || value.trim() === "") return null;
  const s = value.trim();
  if (/^\d{4}$/.test(s)) return null;
  const parsed = new Date(/^\d{4}-\d{2}$/.test(s) ? `${s}-01` : s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function factValue(f: EvidenceFact): string {
  let v: string;
  if (f.valueText !== null && f.valueText !== "") v = f.valueText;
  else if (f.valueNum !== null) v = [f.currency, f.valueNum, f.unit].filter(Boolean).join(" ");
  else if (f.valueDate !== null) v = f.valueDate;
  else if (f.valueBool !== null) v = f.valueBool ? "yes" : "no";
  else if (f.valueJson !== null && f.valueJson !== undefined) v = JSON.stringify(f.valueJson);
  else v = "";
  const quals = Object.entries(f.qualifiers ?? {})
    .map(([k, q]) => `${k}=${q}`)
    .join(", ");
  return clip(quals ? `${v} (${quals})` : v, VALUE_MAX);
}

function recordValue(r: EvidenceRecord): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(r.data)) {
    if (v === null || v === undefined || v === "") continue;
    if (k === "url" || k === "listing_url" || k === "example_record_ids") continue;
    parts.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return clip(parts.join("; "), VALUE_MAX);
}

function recordText(r: EvidenceRecord): string {
  return Object.values(r.data)
    .filter((v): v is string => typeof v === "string")
    .join(" ");
}

function firstSource(ids: string[], all: Map<string, EvidenceSource>): EvidenceSource | null {
  for (const id of ids) {
    const s = all.get(id);
    if (s) return s;
  }
  return null;
}

interface Candidate {
  item: EvidenceItem;
  statedDate: string | null;
  text: string;
  rating: number | null;
}

function factCandidate(f: EvidenceFact, origin: EvidenceItem["origin"], all: Map<string, EvidenceSource>): Candidate {
  const source = firstSource(f.sourceIds, all);
  const stated = isoDay(f.asOf) ?? isoDay(f.valueDate);
  const seen = source ? isoDay(source.fetchedAt) : null;
  return {
    item: {
      ref: `f:${f.id}`,
      kind: "fact",
      key: f.key,
      value: factValue(f),
      quote: f.quote ? clip(f.quote, QUOTE_MAX) : null,
      url: source?.url ?? null,
      date: stated ?? seen ?? "",
      dateKind: stated ? "stated" : "seen",
      origin,
    },
    statedDate: stated,
    text: `${f.key} ${f.valueText ?? ""}`,
    rating: null,
  };
}

function recordCandidate(r: EvidenceRecord, origin: EvidenceItem["origin"], all: Map<string, EvidenceSource>): Candidate {
  const source = firstSource(r.sourceIds, all);
  let stated: string | null = null;
  for (const field of RECORD_DATE_FIELDS) {
    stated = isoDay(r.data[field]);
    if (stated) break;
  }
  const seen = source ? isoDay(source.fetchedAt) : null;
  const url = typeof r.data["url"] === "string" ? (r.data["url"] as string) : (source?.url ?? null);
  const rating = typeof r.data["rating"] === "number" ? (r.data["rating"] as number) : null;
  return {
    item: {
      ref: `r:${r.id}`,
      kind: "record",
      key: r.type,
      value: recordValue(r),
      quote: r.quote ? clip(r.quote, QUOTE_MAX) : null,
      url,
      date: stated ?? seen ?? "",
      dateKind: stated ? "stated" : "seen",
      origin,
    },
    statedDate: stated,
    text: recordText(r),
    rating,
  };
}

function admits(route: Route, c: Candidate, now: Date, dropped: DroppedCounts): boolean {
  if (route.match && !route.match.test(c.text)) return false;
  if (route.maxRating !== undefined && (c.rating === null || c.rating > route.maxRating)) return false;
  const date = route.statedDate ? c.statedDate : c.item.date || null;
  if (!date) {
    dropped.undated += 1;
    return false;
  }
  if (route.windowDays !== undefined && now.getTime() - new Date(date).getTime() > route.windowDays * DAY_MS) {
    dropped.stale += 1;
    return false;
  }
  return true;
}

/** Sort usable rows into buckets; pure, so the rules are testable without a database. */
export function buildPack(input: PackInput, rules: BucketRule[] = ALL_RULES): BuiltPack {
  const dropped: DroppedCounts = { unverified: 0, notesOnly: 0, undated: 0, stale: 0 };
  const facts: Candidate[] = [];
  const recs: Candidate[] = [];
  for (const f of input.facts) {
    const origin = usableOrigin(f);
    if (!origin) dropped.unverified += 1;
    else facts.push(factCandidate(f, origin, input.sources));
  }
  for (const r of input.records) {
    const origin = usableOrigin(r);
    if (!origin) dropped.unverified += 1;
    else recs.push(recordCandidate(r, origin, input.sources));
  }
  const buckets = {} as Buckets;
  const used = new Set<string>();
  for (const rule of rules) {
    const items = new Map<string, EvidenceItem>();
    for (const route of rule.routes) {
      const wantsFact = (key: string) =>
        (route.factKeys?.includes(key) ?? false) || (route.keyPrefixes?.some((p) => key.startsWith(p)) ?? false);
      const pool = [
        ...facts.filter((c) => wantsFact(c.item.key)),
        ...(route.recordTypes ? recs.filter((c) => route.recordTypes!.includes(c.item.key)) : []),
      ];
      for (const c of pool) {
        if (items.has(c.item.ref)) continue;
        if (c.item.origin === "notes" && !rule.allowNotes) {
          dropped.notesOnly += 1;
          continue;
        }
        if (admits(route, c, input.now, dropped)) items.set(c.item.ref, c.item);
      }
    }
    const sorted = [...items.values()].sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref));
    buckets[rule.key] = sorted.slice(0, BUCKET_ITEM_MAX);
    for (const item of buckets[rule.key]) used.add(item.ref);
  }
  return { buckets, dropped, usable: used.size };
}

export interface CompanyHeader {
  name: string | null;
  domain: string | null;
  country: string | null;
  employees: number | null;
}

export interface PreflightSummary {
  businessType: string;
  primaryCategory: string;
  reason: string;
}

export interface EvidencePack extends BuiltPack {
  companyId: string;
  sectorId: string;
  company: CompanyHeader;
  preflight: PreflightSummary | null;
  revenue: { revenueUsed: number | null; revenueSource: string | null; tier: string | null; flags: string[] };
  playbook?: "d2c" | "ria";
  /** Preflight reason key when the ria preflight kept the firm aside. */
  riaExclusion?: string | null;
}

const FACT_KEYS = [...new Set(ALL_RULES.flatMap((r) => r.routes.flatMap((route) => route.factKeys ?? [])))];
const KEY_PREFIXES = [...new Set(ALL_RULES.flatMap((r) => r.routes.flatMap((route) => route.keyPrefixes ?? [])))];
const RECORD_TYPES = [...new Set(ALL_RULES.flatMap((r) => r.routes.flatMap((route) => route.recordTypes ?? [])))];

/** AUM/staff history -> one firm.growth fact when growth is 20%+ (icp.md section 4). */
async function growthFact(db: Db, companyId: string): Promise<EvidenceFact | null> {
  const history = await db
    .select()
    .from(facts)
    .where(and(eq(facts.companyId, companyId), inArray(facts.key, ["firm.regulatory_aum", "financials.employees"])))
    .orderBy(asc(facts.createdAt));
  const series = (key: string) =>
    history
      .filter((f) => f.key === key && f.valueNum !== null && f.asOf)
      .map((f) => ({ n: Number(f.valueNum), asOf: String(f.asOf).slice(0, 10), row: f }))
      .filter((x) => Number.isFinite(x.n))
      .sort((a, b) => a.asOf.localeCompare(b.asOf));
  for (const key of ["firm.regulatory_aum", "financials.employees"] as const) {
    const points = series(key);
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || first === last || first.n <= 0) continue;
    const days = (new Date(last.asOf).getTime() - new Date(first.asOf).getTime()) / 86_400_000;
    const pct = (last.n - first.n) / first.n;
    if (days < 180 || pct < 0.2) continue;
    const label = key === "firm.regulatory_aum" ? "AUM" : "staff";
    return {
      id: last.row.id,
      key: "firm.growth",
      valueText: `${label} ${first.n} (${first.asOf}) -> ${last.n} (${last.asOf}), +${Math.round(pct * 100)}%`,
      valueNum: null,
      valueDate: null,
      valueBool: null,
      valueJson: null,
      currency: null,
      unit: null,
      qualifiers: {},
      asOf: last.asOf,
      sourceIds: last.row.sourceIds ?? [],
      verification: "verified",
      quote: null,
      createdBy: "collector:sec_import",
    };
  }
  return null;
}

/** Load and build the pack for one company in one sector. */
export async function icpEvidence(db: Db, sectorId: string, companyId: string, now = new Date()): Promise<EvidencePack> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${companyId}`);
  const sectorProfile = await getProfileOrNull(db, sectorId);
  const playbook: "d2c" | "ria" = sectorProfile?.playbook === "ria" ? "ria" : "d2c";
  const rules: BucketRule[] = playbook === "ria" ? RIA_SIGNAL_RULES : ALL_RULES;
  const factKeys = [...new Set(rules.flatMap((r) => r.routes.flatMap((route) => route.factKeys ?? [])))];
  const keyPrefixes = [...new Set(rules.flatMap((r) => r.routes.flatMap((route) => route.keyPrefixes ?? [])))];
  const recordTypes = [...new Set(rules.flatMap((r) => r.routes.flatMap((route) => route.recordTypes ?? [])))];
  const [factRows, recordRows, [preflight], truth, membershipRows] = await Promise.all([
    db
      .select()
      .from(factsCurrent)
      .where(
        and(
          eq(factsCurrent.companyId, companyId),
          or(inArray(factsCurrent.key, factKeys), ...keyPrefixes.map((p) => like(factsCurrent.key, `${p}%`))),
        ),
      ),
    db
      .select()
      .from(records)
      .where(and(eq(records.companyId, companyId), inArray(records.type, recordTypes))),
    db
      .select()
      .from(sectorPreflight)
      .where(and(eq(sectorPreflight.sectorId, sectorId), eq(sectorPreflight.companyId, companyId))),
    companyRevenueTruth(db, companyId, sectorId),
    db
      .select({ eligibility: sectorCompanies.eligibility, eligibilityReason: sectorCompanies.eligibilityReason })
      .from(sectorCompanies)
      .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId))),
  ]);
  const membership = membershipRows[0];
  const riaExclusion =
    playbook === "ria" && membership?.eligibility === "ineligible" ? (membership.eligibilityReason ?? "ineligible") : null;
  const sourceIds = [...new Set([...factRows, ...recordRows].flatMap((r) => r.sourceIds ?? []))];
  const sourceMap = new Map<string, EvidenceSource>();
  for (let i = 0; i < sourceIds.length; i += 500) {
    const rows = await db
      .select({ id: sources.id, url: sources.finalUrl, fetchedAt: sources.fetchedAt })
      .from(sources)
      .where(inArray(sources.id, sourceIds.slice(i, i + 500)));
    for (const s of rows) sourceMap.set(s.id, { url: s.url, fetchedAt: s.fetchedAt });
  }
  const mappedFacts: EvidenceFact[] = factRows.map((f) => ({
    id: f.id,
    key: f.key,
    valueText: f.valueText,
    valueNum: f.valueNum,
    valueDate: f.valueDate,
    valueBool: f.valueBool,
    valueJson: f.valueJson,
    currency: f.currency,
    unit: null,
    qualifiers: (f.qualifiers ?? {}) as Record<string, string>,
    asOf: f.asOf,
    sourceIds: f.sourceIds ?? [],
    verification: f.verification,
    quote: f.quote,
    createdBy: f.createdBy,
  }));
  if (playbook === "ria") {
    const growth = await growthFact(db, companyId);
    if (growth) mappedFacts.push(growth);
  }
  const built = buildPack(
    {
      facts: mappedFacts,
      records: recordRows.map((r) => ({
        id: r.id,
        type: r.type,
        data: r.data,
        sourceIds: r.sourceIds,
        verification: r.verification,
        quote: r.quote,
        createdBy: r.createdBy,
      })),
      sources: sourceMap,
      now,
    },
    rules,
  );
  return {
    ...built,
    companyId,
    sectorId,
    company: {
      name: company.name,
      domain: company.domain,
      country: company.country,
      employees: truth.staff?.count ?? null,
    },
    preflight: preflight
      ? { businessType: preflight.businessType, primaryCategory: preflight.primaryCategory, reason: preflight.reason }
      : null,
    revenue: {
      revenueUsed: truth.revenueUsed,
      revenueSource: truth.revenueSource,
      tier: truth.tier,
      flags: truth.flags,
    },
    playbook,
    riaExclusion,
  };
}
