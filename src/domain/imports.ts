import { createHash, randomUUID } from "node:crypto";
import { facts as factsTable, factKeys } from "../db/schema.js";
import { validateTypedValue } from "./research/validate.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, sep } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { companies, imports, sectorCompanies, sectors, type Import } from "../db/schema.js";
import type { Db, DbLike } from "../db/client.js";
import { ApolloFileError, parseApolloCsv, type ParsedCompany } from "../lib/apollo/parse.js";
import { extractSecCsv, parseSecCsv, SecFileError, secFileDate, type SecCompany } from "../lib/sec/parse.js";
import { normalizeDomain } from "../lib/apollo/parse.js";
import { getImportDirs } from "../lib/env.js";
import { getOrCreateManualRun } from "../runs/queue.js";
import { recomputeSharedDomains } from "./companies.js";
import { DomainError } from "./errors.js";
import type { AddFactItem } from "./research/facts.js";
import { createApolloImportSource, createSecImportSource } from "./research/sources.js";

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const SEC_MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_SKIPPED_ENTRIES = 200;

export interface ImportSuccess {
  path: string;
  ok: true;
  import: Import;
}

export interface ImportFailure {
  path: string;
  ok: false;
  error: { code: "file_error"; message: string };
}

export type FileImportResult = ImportSuccess | ImportFailure;

/** Resolve each allowed dir; missing dirs simply allow nothing. */
async function resolveImportDirs(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const dir of dirs) {
    try {
      out.push(await realpath(dir));
    } catch {
      // Missing dir: contributes no allowed paths.
    }
  }
  return out;
}

function insideDirs(resolved: string, dirs: string[]): boolean {
  return dirs.some((dir) => resolved === dir || resolved.startsWith(dir + sep));
}

/** Fail fast on unreadable, out-of-jail, or oversized files. Returns resolved paths. */
export async function checkImportPaths(
  paths: string[],
  importDirs: string[],
  maxBytes: number = MAX_FILE_BYTES,
): Promise<string[]> {
  const dirs = await resolveImportDirs(importDirs);
  const resolved: string[] = [];
  for (const path of paths) {
    let full: string;
    try {
      full = await realpath(path);
    } catch {
      throw new DomainError("file_error", `cannot read file: ${path}`);
    }
    if (!insideDirs(full, dirs)) {
      throw new DomainError("invalid_input", `path is outside KARDATA_IMPORT_DIRS: ${path}`);
    }
    let size = 0;
    let isFile = false;
    try {
      const st = await stat(full);
      size = st.size;
      isFile = st.isFile();
    } catch {
      throw new DomainError("file_error", `cannot read file: ${path}`);
    }
    if (!isFile) throw new DomainError("invalid_input", `not a file: ${path}`);
    if (size > maxBytes) {
      throw new DomainError("invalid_input", `file exceeds ${Math.round(maxBytes / (1024 * 1024))} MB: ${path}`);
    }
    resolved.push(full);
  }
  return resolved;
}

function typedColumns(row: ParsedCompany) {
  return {
    domain: row.domain,
    name: row.name,
    website: row.website,
    linkedinUrl: row.linkedinUrl,
    facebookUrl: row.facebookUrl,
    twitterUrl: row.twitterUrl,
    employees: row.employees,
    industry: row.industry,
    keywords: row.keywords,
    technologies: row.technologies,
    country: row.country,
    state: row.state,
    city: row.city,
    postalCode: row.postalCode,
    address: row.address,
    phone: row.phone,
    annualRevenue: row.annualRevenue,
    totalFunding: row.totalFunding,
    latestFunding: row.latestFunding,
    latestFundingAmount: row.latestFundingAmount,
    lastRaisedAt: row.lastRaisedAt,
    foundedYear: row.foundedYear,
    shortDescription: row.shortDescription,
    logoUrl: row.logoUrl,
    sicCodes: row.sicCodes,
    naicsCodes: row.naicsCodes,
    raw: row.raw,
  };
}

/**
 * Import one file inside the caller's transaction. Parse errors return a
 * failure result and write nothing; upserts and the import row are atomic.
 */
export async function importOneFile(
  tx: DbLike,
  sectorId: string,
  givenPath: string,
): Promise<FileImportResult> {
  const importId = randomUUID();
  let text: string;
  let sha256: string;
  try {
    const bytes = await readFile(givenPath);
    sha256 = createHash("sha256").update(bytes).digest("hex");
    text = bytes.toString("utf8");
  } catch {
    return {
      path: givenPath,
      ok: false,
      error: { code: "file_error", message: `cannot read file: ${givenPath}` },
    };
  }
  let parsed: { rows: ParsedCompany[]; skipped: { row: number; reason: string }[] };
  try {
    parsed = parseApolloCsv(text);
  } catch (err) {
    const message = err instanceof ApolloFileError ? err.message : `unparseable CSV: ${givenPath}`;
    return { path: givenPath, ok: false, error: { code: "file_error", message } };
  }

  // Same id twice in one file: last row wins, counted once.
  const byId = new Map<string, ParsedCompany>();
  for (const row of parsed.rows) byId.set(row.apolloAccountId, row);

  const skippedEntries = [...parsed.skipped];
  const affectedDomains = new Set<string>();
  let created = 0;
  let linked = 0;
  let updated = 0;

  for (const row of byId.values()) {
    const existing = await tx.query.companies.findFirst({
      where: eq(companies.apolloAccountId, row.apolloAccountId),
    });
    // Every processed row snapshots its raw JSON as an apollo_import source
    // (removed rows skip below before reaching it).
    const snapshotSource = async (companyId: string): Promise<void> => {
      const runId = await getOrCreateManualRun(tx, companyId);
      await createApolloImportSource(tx, {
        companyId,
        runId,
        importId,
        apolloAccountId: row.apolloAccountId,
        raw: row.raw,
      });
    };
    if (existing) {
      const membership = await tx.query.sectorCompanies.findFirst({
        where: and(
          eq(sectorCompanies.sectorId, sectorId),
          eq(sectorCompanies.companyId, existing.id),
        ),
      });
      if (membership?.removedAt) {
        skippedEntries.push({ row: row.rowNumber, reason: "removed by owner" });
        continue;
      }
      if (existing.domain) affectedDomains.add(existing.domain);
      await tx.update(companies).set(typedColumns(row)).where(eq(companies.id, existing.id));
      await snapshotSource(existing.id);
      updated += 1;
      if (membership) {
        await tx
          .update(sectorCompanies)
          .set({ lastImportId: importId })
          .where(
            and(
              eq(sectorCompanies.sectorId, sectorId),
              eq(sectorCompanies.companyId, existing.id),
            ),
          );
      } else {
        await tx.insert(sectorCompanies).values({
          sectorId,
          companyId: existing.id,
          addedVia: "csv",
          firstImportId: importId,
          lastImportId: importId,
        });
        linked += 1;
      }
    } else {
      const [createdRow] = await tx
        .insert(companies)
        .values({
          id: randomUUID(),
          apolloAccountId: row.apolloAccountId,
          source: "apollo",
          ...typedColumns(row),
        })
        .returning({ id: companies.id });
      if (!createdRow) throw new Error("insert returned no row");
      await tx.insert(sectorCompanies).values({
        sectorId,
        companyId: createdRow.id,
        addedVia: "csv",
        firstImportId: importId,
        lastImportId: importId,
      });
      await snapshotSource(createdRow.id);
      created += 1;
    }
    if (row.domain) affectedDomains.add(row.domain);
  }

  await recomputeSharedDomains(tx, affectedDomains);

  const [importRow] = await tx
    .insert(imports)
    .values({
      id: importId,
      sectorId,
      filename: basename(givenPath),
      fileSha256: sha256,
      rowsRead: parsed.rows.length + parsed.skipped.length,
      createdCount: created,
      linkedCount: linked,
      updatedCount: updated,
      skippedCount: skippedEntries.length,
      skipped: skippedEntries.slice(0, MAX_SKIPPED_ENTRIES),
    })
    .returning();
  if (!importRow) throw new Error("insert returned no row");
  return { path: givenPath, ok: true, import: importRow };
}

export async function importCsv(
  db: Db,
  sectorId: string,
  paths: string[],
  opts: { importDirs?: string[] } = {},
): Promise<FileImportResult[]> {
  if (paths.length === 0) throw new DomainError("invalid_input", "no files to import");
  if (paths.length > MAX_FILES) {
    throw new DomainError("invalid_input", `at most ${MAX_FILES} files per import`);
  }
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, sectorId) });
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  await checkImportPaths(paths, opts.importDirs ?? getImportDirs());
  const results: FileImportResult[] = [];
  for (const path of paths) {
    results.push(await db.transaction((tx) => importOneFile(tx, sectorId, path)));
  }
  return results;
}

// ---- SEC adviser file import (Stage 5.7 B2) ----

function secTypedColumns(row: SecCompany) {
  return {
    domain: row.domain ?? normalizeDomain(row.website),
    name: row.name,
    website: row.website,
    employees: row.employees,
    country: row.country,
    state: row.state,
    city: row.city,
    postalCode: row.postalCode,
    address: row.address,
    phone: row.phone,
    keywords: [] as string[],
    technologies: [] as string[],
    sicCodes: [] as string[],
    naicsCodes: [] as string[],
    raw: row.raw as unknown as Record<string, unknown>,
  };
}

const SEC_FACT_TYPES: Record<string, string> = {
  "firm.regulatory_aum": "number",
  "firm.accounts": "number",
  "firm.wealth_share": "number",
  "firm.client_individuals": "number",
  "firm.client_hnw": "number",
  "firm.client_total": "number",
  "firm.client_pension": "number",
  "firm.client_trusts": "number",
  "firm.offices": "number",
  "firm.private_fund_count": "number",
  "firm.compensation_types": "text_list",
  "firm.registration_status": "text",
  "firm.firm_type": "text",
  "firm.sec_number": "text",
  "firm.filing_date": "date",
  "financials.employees": "number",
};

/** Bulk fact write for the SEC import: keys ensured once, one insert per firm. */
async function insertSecFacts(
  tx: DbLike,
  companyId: string,
  runId: string,
  items: AddFactItem[],
  ensured: Set<string>,
): Promise<void> {
  if (items.length === 0) return;
  const existing = ensured.size > 0 ? [] : await tx.select({ key: factKeys.key }).from(factKeys);
  const have = new Set([...ensured, ...existing.map((r) => r.key)]);
  for (const [key, type] of Object.entries(SEC_FACT_TYPES)) {
    if (have.has(key)) continue;
    ensured.add(key);
    await tx
      .insert(factKeys)
      .values({ key, valueType: type as never, unit: null, description: "", qualifierNames: [], status: "provisional", createdBy: "collector:sec_import" })
      .onConflictDoNothing();
  }
  for (const key of Object.keys(SEC_FACT_TYPES)) ensured.add(key);
  const rows = items.map((item) => {
    const type = SEC_FACT_TYPES[item.key] ?? "text";
    const typed = validateTypedValue(type, item.value, `fact "${item.key}"`);
    return {
      id: randomUUID(),
      companyId,
      runId,
      key: item.key,
      valueNum: typed.valueNum,
      valueText: typed.valueText,
      valueDate: typed.valueDate,
      valueBool: typed.valueBool,
      valueJson: typed.valueJson,
      currency: typed.currency,
      unit: null,
      qualifiers: {},
      asOf: item.asOf ?? null,
      validFrom: null,
      validTo: null,
      sourceIds: item.sourceIds,
      confidence: (item.confidence ?? "high") as "high" | "medium" | "low",
      createdBy: "collector:sec_import",
    };
  });
  await tx.insert(factsTable).values(rows);
}

function secFacts(row: SecCompany, sourceId: string, fileDate: string | null): AddFactItem[] {
  const items: AddFactItem[] = [];
  const push = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    items.push({ key, value, sourceIds: [sourceId], confidence: "high", asOf: fileDate, quote: null, quoteSourceId: null });
  };
  push("firm.regulatory_aum", row.regulatoryAum);
  push("firm.accounts", row.accounts);
  push("firm.wealth_share", row.wealthShare);
  push("firm.client_individuals", row.individuals);
  push("firm.client_hnw", row.hnw);
  push("firm.client_total", row.totalClients);
  if (row.compensationTypes.length > 0) {
    items.push({
      key: "firm.compensation_types",
      value: row.compensationTypes,
      sourceIds: [sourceId],
      confidence: "high",
      asOf: fileDate,
      quote: null,
      quoteSourceId: null,
    });
  }
  push("firm.registration_status", row.registrationStatus);
  push("firm.firm_type", row.firmType);
  push("firm.sec_number", row.secNumber);
  push("firm.filing_date", row.filingDate);
  push("financials.employees", row.employees);
  push("firm.client_pension", row.pensionClients);
  push("firm.client_trusts", row.trustClients);
  push("firm.offices", row.offices);
  push("firm.private_fund_count", row.privateFundCount);
  return items;
}

/**
 * Import one SEC file (ZIP or extracted CSV) inside the caller's transaction.
 * Companies are keyed by CRD; re-import writes fresh facts and keeps history.
 */
export async function importSecOneFile(
  tx: DbLike,
  sectorId: string,
  givenPath: string,
): Promise<FileImportResult> {
  const importId = randomUUID();
  let bytes: Buffer;
  let sha256: string;
  try {
    bytes = await readFile(givenPath);
    sha256 = createHash("sha256").update(bytes).digest("hex");
  } catch {
    return { path: givenPath, ok: false, error: { code: "file_error", message: `cannot read file: ${givenPath}` } };
  }
  let text: string;
  let fileDate: string | null = secFileDate(basename(givenPath));
  try {
    if (basename(givenPath).toLowerCase().endsWith(".zip")) {
      const extracted = extractSecCsv(bytes);
      text = extracted.text;
      fileDate = secFileDate(extracted.csvName) ?? fileDate;
    } else {
      text = bytes.toString("utf8");
    }
  } catch (err) {
    const message = err instanceof SecFileError ? err.message : `unparseable file: ${givenPath}`;
    return { path: givenPath, ok: false, error: { code: "file_error", message } };
  }
  let parsed: { rows: SecCompany[]; skipped: { row: number; reason: string }[] };
  try {
    parsed = parseSecCsv(text);
  } catch (err) {
    const message = err instanceof SecFileError ? err.message : `unparseable CSV: ${givenPath}`;
    return { path: givenPath, ok: false, error: { code: "file_error", message } };
  }
  const byCrd = new Map<string, SecCompany>();
  for (const row of parsed.rows) byCrd.set(row.crd, row);
  const skippedEntries = [...parsed.skipped];
  const affectedDomains = new Set<string>();
  const ensuredKeys = new Set<string>();
  let created = 0;
  let linked = 0;
  let updated = 0;
  for (const row of byCrd.values()) {
    const existing = await tx.query.companies.findFirst({ where: eq(companies.secCrd, row.crd) });
    if (existing) {
      const membership = await tx.query.sectorCompanies.findFirst({
        where: and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, existing.id)),
      });
      if (membership?.removedAt) {
        skippedEntries.push({ row: row.rowNumber, reason: "removed by owner" });
        continue;
      }
      if (existing.domain) affectedDomains.add(existing.domain);
      await tx.update(companies).set(secTypedColumns(row)).where(eq(companies.id, existing.id));
      const runId = await getOrCreateManualRun(tx, existing.id);
      const sourceId = await createSecImportSource(tx, {
        companyId: existing.id,
        runId,
        importId,
        crd: row.crd,
        raw: row.raw,
      });
      await insertSecFacts(tx, existing.id, runId, secFacts(row, sourceId, fileDate), ensuredKeys);
      updated += 1;
      if (membership) {
        await tx
          .update(sectorCompanies)
          .set({ lastImportId: importId })
          .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, existing.id)));
      } else {
        await tx.insert(sectorCompanies).values({
          sectorId,
          companyId: existing.id,
          addedVia: "sec",
          firstImportId: importId,
          lastImportId: importId,
        });
        linked += 1;
      }
    } else {
      const [createdRow] = await tx
        .insert(companies)
        .values({ id: randomUUID(), secCrd: row.crd, source: "sec", ...secTypedColumns(row) })
        .returning({ id: companies.id });
      if (!createdRow) throw new Error("insert returned no row");
      await tx.insert(sectorCompanies).values({
        sectorId,
        companyId: createdRow.id,
        addedVia: "sec",
        firstImportId: importId,
        lastImportId: importId,
      });
      const runId = await getOrCreateManualRun(tx, createdRow.id);
      const sourceId = await createSecImportSource(tx, {
        companyId: createdRow.id,
        runId,
        importId,
        crd: row.crd,
        raw: row.raw,
      });
      await insertSecFacts(tx, createdRow.id, runId, secFacts(row, sourceId, fileDate), ensuredKeys);
      created += 1;
    }
    const domain = row.domain ?? normalizeDomain(row.website);
    if (domain) affectedDomains.add(domain);
  }
  await recomputeSharedDomains(tx, affectedDomains);
  const [importRow] = await tx
    .insert(imports)
    .values({
      id: importId,
      sectorId,
      filename: basename(givenPath),
      fileSha256: sha256,
      rowsRead: parsed.rows.length + parsed.skipped.length,
      createdCount: created,
      linkedCount: linked,
      updatedCount: updated,
      skippedCount: skippedEntries.length,
      skipped: skippedEntries.slice(0, MAX_SKIPPED_ENTRIES),
    })
    .returning();
  if (!importRow) throw new Error("insert returned no row");
  return { path: givenPath, ok: true, import: importRow };
}

export async function importSec(
  db: Db,
  sectorId: string,
  path: string,
  opts: { importDirs?: string[] } = {},
): Promise<FileImportResult> {
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, sectorId) });
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  await checkImportPaths([path], opts.importDirs ?? getImportDirs(), SEC_MAX_FILE_BYTES);
  return db.transaction((tx) => importSecOneFile(tx, sectorId, path));
}

export async function listImports(db: Db, sectorId: string): Promise<Import[]> {
  const sector = await db.query.sectors.findFirst({ where: eq(sectors.id, sectorId) });
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  return db
    .select()
    .from(imports)
    .where(eq(imports.sectorId, sectorId))
    .orderBy(desc(imports.createdAt));
}
