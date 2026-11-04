import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db, DbLike } from "../db/client.js";
import { companies, sectorCompanies, sectors } from "../db/schema.js";
import { DomainError } from "./errors.js";

const LIBRARY_NAME = "Internal evidence library";

/** Share the exclusion rule across prospect queries, including projections of memberships. */
export function prospectMembership() {
  return sql`not exists (select 1 from companies as library_company
    where library_company.id = ${sectorCompanies.companyId} and library_company.evidence_library)
    and not exists (select 1 from sectors as library_sector
    where library_sector.id = ${sectorCompanies.sectorId} and library_sector.evidence_library)`;
}

export async function requireProspectSector(db: DbLike, sectorId: string): Promise<void> {
  const [row] = await db.select({ library: sectors.evidenceLibrary }).from(sectors).where(eq(sectors.id, sectorId));
  if (row?.library) throw new DomainError("invalid_input", "the evidence library is outside prospect workflows");
}

export async function requireProspectCompany(db: DbLike, companyId: string): Promise<void> {
  const [row] = await db.select({ library: companies.evidenceLibrary }).from(companies).where(eq(companies.id, companyId));
  if (row?.library) throw new DomainError("invalid_input", "the evidence library is outside prospect workflows");
}

export async function findEvidenceLibrary(db: DbLike) {
  const [row] = await db.select({ sectorId: sectors.id, companyId: companies.id })
    .from(sectors)
    .innerJoin(sectorCompanies, eq(sectors.id, sectorCompanies.sectorId))
    .innerJoin(companies, eq(companies.id, sectorCompanies.companyId))
    .where(and(eq(sectors.evidenceLibrary, true), eq(companies.evidenceLibrary, true)));
  return row;
}

export async function ensureEvidenceLibrary(db: Db) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('evidence-library'))`);
    const existing = await findEvidenceLibrary(tx);
    if (existing) return existing;
    const sectorId = randomUUID();
    const companyId = randomUUID();
    const [sector] = await tx.insert(sectors).values({ id: sectorId, name: LIBRARY_NAME, evidenceLibrary: true })
      .onConflictDoNothing().returning({ id: sectors.id });
    if (!sector) throw new DomainError("conflict", "evidence library name is already in use");
    await tx.insert(companies).values({ id: companyId, name: LIBRARY_NAME, source: "manual", evidenceLibrary: true });
    await tx.insert(sectorCompanies).values({ sectorId, companyId, addedVia: "manual" });
    return { sectorId, companyId };
  });
}
