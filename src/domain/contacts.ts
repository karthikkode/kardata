import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, companyContactStatuses, records, sectorCompanies } from "../db/schema.js";
import { normalizeDomain } from "../lib/apollo/parse.js";
import { DomainError } from "./errors.js";
import { sectorCompaniesScope } from "./sectors.js";

/**
 * Contact statuses (D-67). A company has one row per status it has reached.
 * They are separate from the ICP status (icp_accepted / icp_watchlist /
 * icp_rejected), which says whether we want to contact a company at all.
 *
 * - Public rows: names and roles from cited leader records. Research never
 *   collects emails or phone numbers.
 * - Apollo rows: written only from the owner's own Apollo pulls.
 * - Contactable means one thing: an email_verified_apollo row exists.
 */

export const PUBLIC_CONTACT_STATUSES = ["name_verified_public", "role_verified_public"] as const;
export const APOLLO_CONTACT_STATUSES = [
  "name_verified_apollo",
  "role_verified_apollo",
  "email_verified_apollo",
  "phone_verified_apollo",
] as const;
export type PublicContactStatus = (typeof PUBLIC_CONTACT_STATUSES)[number];
export type ApolloContactStatus = (typeof APOLLO_CONTACT_STATUSES)[number];
export type ContactStatus = PublicContactStatus | ApolloContactStatus;

export const CONTACTABLE_STATUS: ContactStatus = "email_verified_apollo";

export function isContactable(statuses: Iterable<ContactStatus>): boolean {
  for (const s of statuses) if (s === CONTACTABLE_STATUS) return true;
  return false;
}

/** Same grounded set the research reads use: the quote was found in a source or the notes. */
const GROUNDED = ["verified", "doc_only", "verified_value"] as const;
const PUBLIC_SOURCE = "leader records";

function filled(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Replace a company's public rows from its grounded leader records. */
export async function rederivePublicContacts(
  db: Db,
  companyId: string,
): Promise<Partial<Record<PublicContactStatus, number>>> {
  const leaders = await db
    .select({ data: records.data })
    .from(records)
    .where(
      and(eq(records.companyId, companyId), eq(records.type, "leader"), inArray(records.verification, [...GROUNDED])),
    );
  const counts: Partial<Record<PublicContactStatus, number>> = {};
  const names = leaders.filter((l) => filled(l.data.name)).length;
  const roles = leaders.filter((l) => filled(l.data.role) || filled(l.data.title)).length;
  if (names > 0) counts.name_verified_public = names;
  if (roles > 0) counts.role_verified_public = roles;
  await db.transaction(async (tx) => {
    await tx
      .delete(companyContactStatuses)
      .where(
        and(
          eq(companyContactStatuses.companyId, companyId),
          inArray(companyContactStatuses.status, [...PUBLIC_CONTACT_STATUSES]),
        ),
      );
    const rows = Object.entries(counts).map(([status, people]) => ({
      companyId,
      status: status as PublicContactStatus,
      people,
      source: PUBLIC_SOURCE,
    }));
    if (rows.length > 0) await tx.insert(companyContactStatuses).values(rows);
  });
  return counts;
}

/** Public rows for every current sector member (backfill, or after a research change). */
export async function rederiveSectorPublicContacts(
  db: Db,
  sectorId: string,
): Promise<{ companies: number; withName: number; withRole: number }> {
  const members = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(sectorCompaniesScope(sectorId));
  let withName = 0;
  let withRole = 0;
  for (const m of members) {
    const counts = await rederivePublicContacts(db, m.companyId);
    if (counts.name_verified_public) withName += 1;
    if (counts.role_verified_public) withRole += 1;
  }
  return { companies: members.length, withName, withRole };
}

export interface ApolloContactsInput {
  companyId?: string;
  domain?: string;
  /** People per Apollo status; a status left out or 0 means none. */
  counts: Partial<Record<ApolloContactStatus, number>>;
  /** Which Apollo pull this came from, e.g. "apollo export 2026-11-02". */
  source: string;
}

export type ApolloContactsResult =
  | { ok: true; companyId: string; statuses: ApolloContactStatus[]; contactable: boolean }
  | { ok: false; error: string };

async function resolveCompanyId(db: Db, input: ApolloContactsInput): Promise<string> {
  const hasId = input.companyId !== undefined && input.companyId !== "";
  const hasDomain = input.domain !== undefined && input.domain !== "";
  if (hasId === hasDomain) throw new DomainError("invalid_input", "pass exactly one of companyId or domain");
  if (hasId) {
    const [row] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId!));
    if (!row) throw new DomainError("not_found", `company not found: ${input.companyId}`);
    return row.id;
  }
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new DomainError("invalid_input", "domain is empty after normalization");
  const rows = await db.select({ id: companies.id }).from(companies).where(eq(companies.domain, domain));
  if (rows.length === 0) throw new DomainError("not_found", `no company with domain ${domain}`);
  if (rows.length > 1) throw new DomainError("invalid_input", `${rows.length} companies share ${domain}; pass companyId`);
  return rows[0]!.id;
}

/**
 * Record what one Apollo pull found for each company. A company's Apollo rows
 * are replaced as a set, so a newer pull supersedes an older one. Public rows
 * are never touched. Each item succeeds or fails on its own.
 */
export async function recordApolloContacts(db: Db, items: ApolloContactsInput[]): Promise<ApolloContactsResult[]> {
  const results: ApolloContactsResult[] = [];
  for (const item of items) {
    try {
      if (item.source.trim() === "") throw new DomainError("invalid_input", "source is empty");
      const companyId = await resolveCompanyId(db, item);
      const rows = APOLLO_CONTACT_STATUSES.filter((s) => (item.counts[s] ?? 0) > 0).map((status) => ({
        companyId,
        status,
        people: item.counts[status]!,
        source: item.source.trim(),
      }));
      await db.transaction(async (tx) => {
        await tx
          .delete(companyContactStatuses)
          .where(
            and(
              eq(companyContactStatuses.companyId, companyId),
              inArray(companyContactStatuses.status, [...APOLLO_CONTACT_STATUSES]),
            ),
          );
        if (rows.length > 0) await tx.insert(companyContactStatuses).values(rows);
      });
      const statuses = rows.map((r) => r.status);
      results.push({ ok: true, companyId, statuses, contactable: isContactable(statuses) });
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export interface CompanyContacts {
  companyId: string;
  contactable: boolean;
  statuses: { status: ContactStatus; people: number; source: string; updatedAt: Date }[];
}

export async function companyContacts(db: Db, companyId: string): Promise<CompanyContacts> {
  const rows = await db
    .select({
      status: companyContactStatuses.status,
      people: companyContactStatuses.people,
      source: companyContactStatuses.source,
      updatedAt: companyContactStatuses.updatedAt,
    })
    .from(companyContactStatuses)
    .where(eq(companyContactStatuses.companyId, companyId));
  const order = [...PUBLIC_CONTACT_STATUSES, ...APOLLO_CONTACT_STATUSES] as ContactStatus[];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return { companyId, contactable: isContactable(rows.map((r) => r.status)), statuses: rows };
}

/** Contact statuses for many companies at once (summaries and lists). */
export async function contactStatusesFor(db: Db, companyIds: string[]): Promise<Map<string, ContactStatus[]>> {
  const out = new Map<string, ContactStatus[]>();
  for (let i = 0; i < companyIds.length; i += 500) {
    const batch = companyIds.slice(i, i + 500);
    const rows = await db
      .select({ companyId: companyContactStatuses.companyId, status: companyContactStatuses.status })
      .from(companyContactStatuses)
      .where(inArray(companyContactStatuses.companyId, batch));
    for (const r of rows) out.set(r.companyId, [...(out.get(r.companyId) ?? []), r.status]);
  }
  return out;
}
