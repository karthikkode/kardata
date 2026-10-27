import { randomUUID } from "node:crypto";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { imports, sectorCompanies, sectors, type Import } from "../db/schema.js";
import type { Db, DbLike } from "../db/client.js";
import { getImportDirs } from "../lib/env.js";
import { DomainError, isUniqueViolation } from "./errors.js";
import { parseEligibilityRubric } from "./sector-preflight/eligibility.js";
import { parseSectorProfile } from "./sector-preflight/profile.js";
import { checkImportPaths, importOneFile, MAX_FILES, type FileImportResult } from "./imports.js";

export interface SectorSummary {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  companyCount: number;
  removedCount: number;
}

export interface SectorDetail extends SectorSummary {
  imports: Import[];
}

async function countsOf(
  db: DbLike,
  sectorId: string,
): Promise<{ companyCount: number; removedCount: number }> {
  const [row] = await db
    .select({
      live: count(
        sql`CASE WHEN ${sectorCompanies.removedAt} IS NULL THEN ${sectorCompanies.companyId} END`,
      ).mapWith(Number),
      removed: count(sectorCompanies.removedAt).mapWith(Number),
    })
    .from(sectorCompanies)
    .where(eq(sectorCompanies.sectorId, sectorId));
  return { companyCount: row?.live ?? 0, removedCount: row?.removed ?? 0 };
}

async function detailOf(db: DbLike, sectorId: string): Promise<SectorDetail> {
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, sectorId) });
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  const lastImports = await db
    .select()
    .from(imports)
    .where(eq(imports.sectorId, sectorId))
    .orderBy(desc(imports.createdAt))
    .limit(20);
  const counts = await countsOf(db, sectorId);
  return {
    id: sector.id,
    name: sector.name,
    description: sector.description,
    createdAt: sector.createdAt,
    updatedAt: sector.updatedAt,
    ...counts,
    imports: lastImports,
  };
}

async function existingByName(db: DbLike, name: string) {
  return db.query.sectors.findFirst({
    where: sql`lower(${sectors.name}) = lower(${name})`,
  });
}

export async function createSector(
  db: Db,
  input: { name: string; description?: string; csvPaths?: string[]; profile?: unknown },
  opts: { importDirs?: string[] } = {},
): Promise<{ sector: SectorDetail; imports: FileImportResult[] }> {
  const name = input.name?.trim() ?? "";
  if (name === "") throw new DomainError("invalid_input", "sector name is required");
  const description = input.description ?? "";
  const paths = input.csvPaths ?? [];
  if (paths.length > MAX_FILES) {
    throw new DomainError("invalid_input", `at most ${MAX_FILES} files per import`);
  }
  await checkImportPaths(paths, opts.importDirs ?? getImportDirs());
  const profile = input.profile !== undefined ? parseSectorProfile(input.profile) : null;
  // A rubric included in the profile is stored through the same validated
  // path as sector_rules_set (checked against the profile up front).
  const rubric =
    profile && profile.rubric !== undefined ? parseEligibilityRubric(profile.rubric, profile) : null;
  return db.transaction(async (tx) => {
    if (await existingByName(tx, name)) {
      throw new DomainError("conflict", `sector already exists: ${name}`);
    }
    let sectorId: string;
    try {
      const [row] = await tx
        .insert(sectors)
        .values({
          id: randomUUID(),
          name,
          description,
          profile: profile as Record<string, unknown> | null,
          eligibilityRules: rubric as Record<string, unknown> | null,
        })
        .returning({ id: sectors.id });
      if (!row) throw new Error("insert returned no row");
      sectorId = row.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError("conflict", `sector already exists: ${name}`);
      throw err;
    }
    const results: FileImportResult[] = [];
    for (const path of paths) {
      results.push(await importOneFile(tx, sectorId, path));
    }
    if (paths.length > 0 && results.every((r) => !r.ok)) {
      const first = results[0];
      if (first && !first.ok) throw new DomainError(first.error.code, first.error.message);
      throw new DomainError("file_error", "all files failed to import");
    }
    return { sector: await detailOf(tx, sectorId), imports: results };
  });
}

export async function updateSector(
  db: Db,
  id: string,
  patch: { name?: string; description?: string },
): Promise<SectorSummary> {
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, id) });
  if (!sector) throw new DomainError("not_found", `sector not found: ${id}`);
  const set: { name?: string; description?: string } = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name === "") throw new DomainError("invalid_input", "sector name is required");
    const dupe = await existingByName(db, name);
    if (dupe && dupe.id !== id) throw new DomainError("conflict", `sector already exists: ${name}`);
    set.name = name;
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) {
    const counts = await countsOf(db, id);
    return {
      id: sector.id,
      name: sector.name,
      description: sector.description,
      createdAt: sector.createdAt,
      updatedAt: sector.updatedAt,
      ...counts,
    };
  }
  try {
    await db.update(sectors).set(set).where(eq(sectors.id, id));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError("conflict", `sector already exists: ${patch.name ?? ""}`);
    }
    throw err;
  }
  const updated = await db.query.sectors.findFirst({ where: eq(sectors.id, id) });
  if (!updated) throw new DomainError("not_found", `sector not found: ${id}`);
  const counts = await countsOf(db, id);
  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    ...counts,
  };
}

export async function deleteSector(
  db: Db,
  id: string,
  confirmName: string,
): Promise<{ id: string; name: string }> {
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, id) });
  if (!sector) throw new DomainError("not_found", `sector not found: ${id}`);
  if (confirmName !== sector.name) {
    throw new DomainError("invalid_input", "confirm_name does not match the sector name");
  }
  await db.delete(sectors).where(eq(sectors.id, id));
  return { id, name: sector.name };
}

export async function listSectors(db: Db): Promise<SectorSummary[]> {
  const rows = await db
    .select({
      id: sectors.id,
      name: sectors.name,
      description: sectors.description,
      createdAt: sectors.createdAt,
      updatedAt: sectors.updatedAt,
      live: count(
        sql`CASE WHEN ${sectorCompanies.removedAt} IS NULL THEN ${sectorCompanies.companyId} END`,
      ).mapWith(Number),
      removed: count(sectorCompanies.removedAt).mapWith(Number),
    })
    .from(sectors)
    .leftJoin(sectorCompanies, eq(sectors.id, sectorCompanies.sectorId))
    .groupBy(sectors.id)
    .orderBy(asc(sectors.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    companyCount: r.live,
    removedCount: r.removed,
  }));
}

export async function getSector(db: Db, id: string): Promise<SectorDetail> {
  return detailOf(db, id);
}
