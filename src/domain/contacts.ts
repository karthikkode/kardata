import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  apolloContacts,
  companies,
  companyContactStatuses,
  records,
  sectorCompanies,
  type ApolloContact,
} from "../db/schema.js";
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
 * - Apollo rows: derived from apollo_contacts, the people the owner bought
 *   from Apollo. Stored so nobody is bought twice.
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

export interface ApolloContactInput {
  /** Apollo's person id: the same person is never stored twice. */
  apolloId: string;
  companyId?: string;
  domain?: string;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  /** Apollo's label; only "verified" counts as email_verified_apollo. */
  emailStatus?: string | null;
  mobile?: string | null;
  linkedin?: string | null;
}

export interface ApolloImportInput {
  /** Which Apollo pull this is, e.g. "apollo pull 2026-10-27". */
  source: string;
  pulledAt: Date;
  contacts: ApolloContactInput[];
}

export type ApolloImportResult =
  | { ok: true; apolloId: string; companyId: string; outcome: "created" | "updated" }
  | { ok: false; apolloId: string; error: string };

async function resolveCompanyId(db: Db, input: { companyId?: string; domain?: string }): Promise<string> {
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

function clean(value: string | null | undefined): string | null {
  const v = value?.trim() ?? "";
  return v === "" ? null : v;
}

/**
 * Store the people from one of the owner's Apollo pulls, then rebuild the
 * Apollo contact statuses of every company touched. A person already stored
 * keeps any field the new pull leaves empty, so a later phone-only pull never
 * wipes an email we paid for. Each person succeeds or fails on its own.
 */
export async function importApolloContacts(db: Db, input: ApolloImportInput): Promise<ApolloImportResult[]> {
  const source = input.source.trim();
  if (source === "") throw new DomainError("invalid_input", "source is empty");
  const results: ApolloImportResult[] = [];
  const touched = new Set<string>();
  for (const c of input.contacts) {
    try {
      const apolloId = c.apolloId.trim();
      if (apolloId === "") throw new DomainError("invalid_input", "apolloId is empty");
      const companyId = await resolveCompanyId(db, c);
      const fields = {
        name: clean(c.name),
        title: clean(c.title),
        email: clean(c.email),
        emailStatus: clean(c.emailStatus),
        mobile: clean(c.mobile),
        linkedin: clean(c.linkedin),
      };
      const [existing] = await db.select().from(apolloContacts).where(eq(apolloContacts.apolloId, apolloId));
      if (existing) {
        const merged = Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, v ?? existing[k as keyof typeof fields]]),
        ) as typeof fields;
        await db
          .update(apolloContacts)
          .set({ ...merged, companyId, source, pulledAt: input.pulledAt })
          .where(eq(apolloContacts.apolloId, apolloId));
        if (existing.companyId !== companyId) touched.add(existing.companyId);
      } else {
        await db.insert(apolloContacts).values({ apolloId, companyId, ...fields, source, pulledAt: input.pulledAt });
      }
      touched.add(companyId);
      results.push({ ok: true, apolloId, companyId, outcome: existing ? "updated" : "created" });
    } catch (err) {
      results.push({ ok: false, apolloId: c.apolloId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const companyId of touched) await rederiveApolloContacts(db, companyId);
  return results;
}

/** Replace a company's Apollo rows from its stored Apollo contacts. */
export async function rederiveApolloContacts(
  db: Db,
  companyId: string,
): Promise<Partial<Record<ApolloContactStatus, number>>> {
  const people = await db.select().from(apolloContacts).where(eq(apolloContacts.companyId, companyId));
  const counts: Partial<Record<ApolloContactStatus, number>> = {};
  const add = (status: ApolloContactStatus, n: number) => {
    if (n > 0) counts[status] = n;
  };
  add("name_verified_apollo", people.filter((p) => p.name).length);
  add("role_verified_apollo", people.filter((p) => p.title).length);
  add("email_verified_apollo", people.filter((p) => p.email && p.emailStatus === "verified").length);
  add("phone_verified_apollo", people.filter((p) => p.mobile).length);
  await db.transaction(async (tx) => {
    await tx
      .delete(companyContactStatuses)
      .where(
        and(
          eq(companyContactStatuses.companyId, companyId),
          inArray(companyContactStatuses.status, [...APOLLO_CONTACT_STATUSES]),
        ),
      );
    const rows = Object.entries(counts).map(([status, n]) => ({
      companyId,
      status: status as ApolloContactStatus,
      people: n,
      source: "apollo contacts",
    }));
    if (rows.length > 0) await tx.insert(companyContactStatuses).values(rows);
  });
  return counts;
}

export interface CompanyContacts {
  companyId: string;
  contactable: boolean;
  statuses: { status: ContactStatus; people: number; source: string; updatedAt: Date }[];
  /** The people bought from Apollo. */
  apollo: ApolloContact[];
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
  const apollo = await db.select().from(apolloContacts).where(eq(apolloContacts.companyId, companyId));
  return { companyId, contactable: isContactable(rows.map((r) => r.status)), statuses: rows, apollo };
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
