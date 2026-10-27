import type { Db } from "../../db/client.js";
import type { CompanyIcpCheck } from "../../db/schema.js";
import { sectorSheetRows, type SheetRow } from "../tiering.js";
import type { EvidenceItem } from "./evidence.js";
import type { BucketResult } from "./judge.js";
import { hasTechTeam, latestIcpCheck, sectorIcpCompanies, signalsMet, type SectorIcpCompanyRow } from "./reads.js";
import { SIGNAL_RULES } from "./rules.js";

/**
 * The outreach sheet (Stage 5.5 Step 5): the contactable list by tier, then
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
    const label = SIGNAL_RULES.find((r) => r.key === s.key)?.label ?? s.key;
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
