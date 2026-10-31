import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, documents, facts, factsCurrent, records, type CompanyIcpCheck } from "../../db/schema.js";
import { sectorSheetRows, type SheetRow } from "../tiering.js";
import type { EvidenceItem } from "./evidence.js";
import type { BucketResult } from "./judge.js";
import { hasTechTeam, latestIcpCheck, sectorIcpCompanies, signalsMet, type SectorIcpCompanyRow } from "./reads.js";
import { RIA_SIGNAL_RULES } from "./ria-rules.js";
import { SIGNAL_RULES } from "./rules.js";

const ALL_SIGNAL_RULES = [...SIGNAL_RULES, ...RIA_SIGNAL_RULES];

/**
 * The outreach sheet (Stage 5.5 Step 5): the ICP accepted list by tier, then
 * layer, with what the ICP check saw and blank columns the owner fills in by
 * hand. Roles only for buyers (icp.md section 6), never names.
 */

export const TRACKING_COLUMNS = ["Status", "Buyer 1", "Buyer 2", "Call date", "Email date", "Reply", "Next step", "Notes"];
export const OUTREACH_HEADER = [
  "Tier",
  "Layer",
  "Score",
  "Company",
  "Domain",
  "Country",
  "Company ID",
  "Revenue used",
  "Revenue source",
  "Signals met",
  "Observations",
  "Tech team",
  "Buyer order",
  "Flags",
  ...TRACKING_COLUMNS,
];
export const ALL_HEADER = [
  "Company",
  "Domain",
  "Country",
  "Company ID",
  "Status",
  "Tier",
  "Layer",
  "Score",
  "Exclusion reason",
  "Signals met",
  "Checked at",
];

const OBSERVATIONS_MAX = 3;
/** icp.md section 6: the founder or CEO is the first buyer under about 60 staff. */
const FOUNDER_LED_STAFF = 60;

export interface OutreachRow extends SheetRow {
  signalsMet: string[];
  observations: string[];
  techTeam: boolean;
  buyerOrder: string;
}

export function buyerOrder(staff: number | null): string {
  return staff !== null && staff < FOUNDER_LED_STAFF
    ? "Founder/CEO, then COO/Head of Ops"
    : "COO/Head of Ops, then Head of E-commerce/Growth";
}

/** Counted signals as "label (date): observation url", strongest evidence first. */
export function observations(check: CompanyIcpCheck): string[] {
  const results = (check.results as { signals?: BucketResult[] }).signals ?? [];
  const evidence = new Map((check.evidence as EvidenceItem[]).map((e) => [e.ref, e]));
  const out: string[] = [];
  for (const s of results) {
    if (!s.counted) continue;
    const first = s.refs.map((r) => evidence.get(r)).find((e) => e !== undefined);
    const label = ALL_SIGNAL_RULES.find((r) => r.key === s.key)?.label ?? s.key;
    const date = first?.date ? ` (${first.date})` : "";
    const url = first?.url ? ` ${first.url}` : "";
    out.push(`${label}${date}: ${s.observation}${url}`);
  }
  return out.slice(0, OBSERVATIONS_MAX);
}

export async function outreachSheetRows(db: Db, sectorId: string): Promise<OutreachRow[]> {
  const base = await sectorSheetRows(db, sectorId);
  const rows: OutreachRow[] = [];
  for (const row of base) {
    const check = await latestIcpCheck(db, row.companyId, sectorId);
    rows.push({
      ...row,
      signalsMet: check ? signalsMet(check) : [],
      observations: check ? observations(check) : [],
      techTeam: check ? hasTechTeam(check) : false,
      buyerOrder: buyerOrder(row.staff),
    });
  }
  return rows;
}

function cell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One block per tier (a "Tier X" line, then the header), as the owner's sheet has one tab per tier. */
export function outreachCsv(rows: OutreachRow[]): string {
  const lines: string[] = [];
  let currentTier = "";
  for (const r of rows) {
    if (r.tier !== currentTier) {
      currentTier = r.tier;
      lines.push(`Tier ${r.tier}`, OUTREACH_HEADER.join(","));
    }
    lines.push(
      [
        r.tier,
        r.layer,
        r.score,
        cell(r.company),
        cell(r.domain),
        cell(r.country),
        r.companyId,
        r.revenueUsed,
        cell(r.revenueSource),
        cell(r.signalsMet.join("; ")),
        cell(r.observations.join(" | ")),
        r.techTeam ? "yes" : "",
        cell(r.buyerOrder),
        cell(r.flags),
        ...TRACKING_COLUMNS.map(() => ""),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Every checked company with why it is in or out. */
export async function allCheckedRows(db: Db, sectorId: string): Promise<SectorIcpCompanyRow[]> {
  const rows: SectorIcpCompanyRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await sectorIcpCompanies(db, { sectorId, limit: 500, offset });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) break;
  }
  return rows;
}

// ---- RIA sheet (Stage 5.7 B6): firm, state, time zone, group, layer ----

const STATE_TZ: Record<string, string> = {};
for (const s of ["ME", "VT", "NH", "MA", "RI", "CT", "NY", "NJ", "PA", "DE", "MD", "VA", "WV", "OH", "MI", "IN", "KY", "TN", "SC", "NC", "GA", "FL", "DC"]) STATE_TZ[s] = "America/New_York";
for (const s of ["WI", "IL", "MS", "AL", "MO", "IA", "MN", "AR", "LA", "TX", "OK", "KS", "NE", "SD", "ND"]) STATE_TZ[s] = "America/Chicago";
for (const s of ["MT", "WY", "CO", "UT", "AZ", "NM"]) STATE_TZ[s] = "America/Denver";
for (const s of ["CA", "OR", "WA", "NV"]) STATE_TZ[s] = "America/Los_Angeles";
STATE_TZ["ID"] = "America/Boise";
STATE_TZ["AK"] = "America/Anchorage";
STATE_TZ["HI"] = "Pacific/Honolulu";

export function timeZoneForState(state: string | null): string {
  if (!state) return "";
  return STATE_TZ[state.trim().toUpperCase()] ?? "";
}

const OPS_TITLE = /\b(coo|chief operating|director of operations|head of operations|operations)\b/i;
const CCO_TITLE = /\b(chief compliance|cco)\b/i;
const FOUNDER_TITLE = /\b(founder|managing partner|president|ceo|owner)\b/i;

export function pickContact(leaders: { name: string; title: string }[], group: string): { name: string; title: string } | null {
  const order = group === "R" ? [OPS_TITLE, CCO_TITLE, FOUNDER_TITLE] : [FOUNDER_TITLE, OPS_TITLE];
  for (const pattern of order) {
    const found = leaders.find((l) => pattern.test(l.title));
    if (found) return found;
  }
  return leaders[0] ?? null;
}

export interface RiaSheetRow {
  companyId: string;
  firm: string;
  state: string;
  timeZone: string;
  group: string;
  layer: number;
  score: number;
  signals: string[];
  contactName: string;
  contactTitle: string;
  phone: string;
  website: string;
  aum: string;
  staff: string;
  growth: string;
  feeSummary: string;
  custodians: string;
  brochureDate: string;
}

export const RIA_HEADER = [
  "Firm",
  "State",
  "Time zone",
  "Group",
  "Layer",
  "Score",
  "Signals",
  "Contact name",
  "Contact title",
  "Main phone",
  "Website",
  "AUM",
  "Staff",
  "Growth",
  "Fee summary",
  "Custodians",
  "Brochure date",
  "Company ID",
  ...TRACKING_COLUMNS,
];

function signalsWithQuotes(check: CompanyIcpCheck): string[] {
  const results = (check.results as { signals?: BucketResult[] }).signals ?? [];
  const evidence = new Map((check.evidence as EvidenceItem[]).map((e) => [e.ref, e]));
  const out: string[] = [];
  for (const s of results) {
    if (!s.counted) continue;
    const first = s.refs.map((r) => evidence.get(r)).find((e) => e !== undefined);
    const label = ALL_SIGNAL_RULES.find((r) => r.key === s.key)?.label ?? s.key;
    const quote = first?.quote ? ` "${first.quote}"` : "";
    const date = first?.date ? ` (${first.date})` : "";
    out.push(`${label}${date}: ${s.observation}${quote}`);
  }
  return out;
}

export async function riaSheetRows(db: Db, sectorId: string): Promise<RiaSheetRow[]> {
  const base = await sectorSheetRows(db, sectorId);
  const rows: RiaSheetRow[] = [];
  for (const row of base) {
    const [company] = await db
      .select({ state: companies.state, phone: companies.phone, website: companies.website })
      .from(companies)
      .where(eq(companies.id, row.companyId));
    const leaderRows = await db
      .select({ data: records.data })
      .from(records)
      .where(and(eq(records.companyId, row.companyId), eq(records.type, "leader")));
    const leaders = leaderRows
      .map((r) => r.data as Record<string, unknown>)
      .filter((d) => typeof d["name"] === "string")
      .map((d) => ({ name: String(d["name"]), title: String(d["title"] ?? d["role"] ?? "") }));
    const check = await latestIcpCheck(db, row.companyId, sectorId);
    const contact = pickContact(leaders, row.tier);
    const factRows = await db.select().from(factsCurrent).where(eq(factsCurrent.companyId, row.companyId));
    const byKey = new Map(factRows.map((f) => [f.key, f]));
    const numOf = (key: string): number | null => {
      const v = byKey.get(key)?.valueNum;
      return v === null || v === undefined ? null : Number(v);
    };
    const textOf = (key: string): string => {
      const v = byKey.get(key)?.valueText;
      return typeof v === "string" ? v : "";
    };
    const history = await db.select().from(facts).where(eq(facts.companyId, row.companyId));
    let growth = "";
    for (const key of ["firm.regulatory_aum", "financials.employees"] as const) {
      const pts = history
        .filter((f) => f.key === key && f.valueNum !== null && f.asOf)
        .map((f) => ({ n: Number(f.valueNum), d: String(f.asOf).slice(0, 10) }))
        .filter((x) => Number.isFinite(x.n))
        .sort((a, b) => a.d.localeCompare(b.d));
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (!first || !last || first === last || first.n <= 0) continue;
      const days = (new Date(last.d).getTime() - new Date(first.d).getTime()) / 86_400_000;
      if (days >= 180) growth = `${Math.round(((last.n - first.n) / first.n) * 100)}%`;
    }
    const brochureDocs = await db
      .select({ title: documents.title })
      .from(documents)
      .where(and(eq(documents.companyId, row.companyId), eq(documents.path, "financials/brochure-item-5.md")));
    const brochureDate = /\((\d{4}-\d{2}-\d{2})[),]/.exec(brochureDocs[brochureDocs.length - 1]?.title ?? "")?.[1] ?? "";
    rows.push({
      companyId: row.companyId,
      firm: row.company,
      state: company?.state ?? "",
      timeZone: timeZoneForState(company?.state ?? null),
      group: row.tier,
      layer: row.layer,
      score: row.score,
      signals: check ? signalsWithQuotes(check) : [],
      contactName: contact?.name ?? "",
      contactTitle: contact?.title ?? "",
      phone: company?.phone ?? "",
      website: company?.website ?? "",
      aum: numOf("firm.regulatory_aum") !== null ? String(Math.round(numOf("firm.regulatory_aum") as number)) : "",
      staff: numOf("financials.employees") !== null ? String(Math.round(numOf("financials.employees") as number)) : "",
      growth,
      feeSummary: textOf("firm.fee_schedule").slice(0, 120),
      custodians: textOf("firm.custodians").slice(0, 120),
      brochureDate,
    });
  }
  rows.sort((a, b) => (a.group === b.group ? a.layer - b.layer || b.score - a.score : a.group.localeCompare(b.group)));
  return rows;
}

export function riaCsv(rows: RiaSheetRow[]): string {
  const lines = [RIA_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        cell(r.firm),
        cell(r.state),
        cell(r.timeZone),
        r.group,
        r.layer,
        r.score,
        cell(r.signals.join(" | ")),
        cell(r.contactName),
        cell(r.contactTitle),
        cell(r.phone),
        cell(r.website),
        r.aum,
        r.staff,
        r.growth,
        cell(r.feeSummary),
        cell(r.custodians),
        r.brochureDate,
        r.companyId,
        ...TRACKING_COLUMNS.map(() => ""),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function allCheckedCsv(rows: SectorIcpCompanyRow[]): string {
  const lines = [ALL_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        cell(r.name ?? ""),
        cell(r.domain ?? ""),
        cell(r.country ?? ""),
        r.companyId,
        r.status,
        r.tier ?? "",
        r.layer ?? "",
        r.score,
        cell(r.exclusionReason ?? ""),
        cell(r.signalsMet.join("; ")),
        r.checkedAt.slice(0, 10),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
