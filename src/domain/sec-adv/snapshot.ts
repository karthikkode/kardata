import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbLike } from "../../db/client.js";
import { companies, facts, factKeys, records, sectorCompanies, sectors, sources } from "../../db/schema.js";
import { getImportDirs } from "../../lib/env.js";
import { decodeSecCsv, extractSecCsv, parseSecCsv, type SecCompany } from "../../lib/sec/parse.js";
import { DomainError } from "../errors.js";
import { prospectMembership } from "../evidence-library.js";
import { checkImportPaths, SEC_MAX_FILE_BYTES } from "../imports.js";
import { upsertRecords } from "../research/records.js";
import { isValidDateString, validateTypedValue } from "../research/validate.js";
import { canonicalFile, companyFileEvidence, lockEvidence, SNAPSHOT_COLLECTOR } from "./evidence.js";
import { SNAPSHOT_FIELDS, snapshotValues } from "./fields.js";

export const CANDIDATE_TYPE = "sec_adv_crd_candidate";

export function normalizeCrd(value: unknown): string | null {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^0*[1-9]\d*$/.test(text) ? text.replace(/^0+/, "") : null;
}

function normalizeSecNumber(value: unknown): string | null {
  const match = typeof value === "string" ? /^801\s*-\s*0*([1-9]\d*)$/.exec(value.trim()) : null;
  return match ? `801-${match[1]}` : null;
}

function nameState(name: string | null, state: string | null): string | null {
  const normalizedName = name?.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");
  const normalizedState = state?.trim().toUpperCase();
  return normalizedName && /^[A-Z]{2}$/.test(normalizedState ?? "") ? `${normalizedName}|${normalizedState}` : null;
}

type Firm = { id: string; name: string | null; state: string | null; crds: string[]; secNumbers: string[] };
type Match = { companyId: string; method: "crd" | "sec_number" | "name_state"; row: SecCompany };
type Exception = { companyId: string; reason: string };

export function matchSnapshot(firms: Firm[], rows: SecCompany[], existingCrds: Map<string, string>) {
  const index = (keys: (row: SecCompany) => (string | null)[]) => {
    const map = new Map<string, SecCompany[]>();
    for (const row of rows) for (const key of new Set(keys(row))) if (key) {
      const group = map.get(key) ?? [];
      group.push(row);
      map.set(key, group);
    }
    return map;
  };
  const byCrd = index(row => [normalizeCrd(row.crd)]);
  const bySec = index(row => [normalizeSecNumber(row.secNumber)]);
  const byName = index(row => [nameState(row.legalName, row.state), nameState(row.name, row.state)]);
  const tentative: Match[] = [];
  const unmatched: Exception[] = [];
  const ambiguous: Exception[] = [];
  for (const firm of firms) {
    if (firm.crds.length > 1 || firm.secNumbers.length > 1) {
      ambiguous.push({ companyId: firm.id, reason: "conflicting stored identifiers" });
      continue;
    }
    const crd = firm.crds[0];
    const sec = firm.secNumbers[0];
    const name = nameState(firm.name, firm.state);
    const secMatches = sec ? bySec.get(sec) ?? [] : [];
    const matches = crd ? byCrd.get(crd) ?? [] : secMatches.length ? secMatches : name ? byName.get(name) ?? [] : [];
    const method = crd ? "crd" : secMatches.length ? "sec_number" : "name_state";
    const [row] = matches;
    if (!row) {
      unmatched.push({ companyId: firm.id, reason: "no matching registered firm in the release" });
      continue;
    }
    const rowCrd = normalizeCrd(row.crd)!;
    const rowSec = normalizeSecNumber(row.secNumber);
    const otherOwner = existingCrds.get(rowCrd);
    if (matches.length !== 1 || (byCrd.get(rowCrd)?.length ?? 0) > 1 ||
        (sec && rowSec && sec !== rowSec) || (otherOwner && otherOwner !== firm.id)) {
      ambiguous.push({ companyId: firm.id, reason: "duplicate SEC row or conflicting identifier" });
      continue;
    }
    tentative.push({ companyId: firm.id, method, row });
  }
  const claims = new Map<string, number>();
  for (const match of tentative) {
    const crd = normalizeCrd(match.row.crd)!;
    claims.set(crd, (claims.get(crd) ?? 0) + 1);
  }
  const matches = tentative.filter(match => {
    if (claims.get(normalizeCrd(match.row.crd)!) === 1) return true;
    ambiguous.push({ companyId: match.companyId, reason: "multiple companies claim this filing" });
    return false;
  });
  return { matches, unmatched, ambiguous };
}

export async function activeMembers(db: DbLike, sectorId: string) {
  const [sector] = await db.select({ id: sectors.id, library: sectors.evidenceLibrary }).from(sectors).where(eq(sectors.id, sectorId));
  if (!sector) throw new DomainError("not_found", "sector does not exist");
  if (sector.library) throw new DomainError("invalid_input", "the evidence library cannot be a benchmark cohort");
  return db.select({
    id: companies.id, crd: companies.secCrd,
    name: sql<string | null>`coalesce(${companies.overrides}->>'name', ${companies.name})`,
    state: sql<string | null>`coalesce(${companies.overrides}->>'state', ${companies.state})`,
    website: sql<string | null>`coalesce(${companies.overrides}->>'website', ${companies.website})`,
    secNumber: sql<string | null>`${companies.raw}->>'SEC#'`,
  }).from(sectorCompanies).innerJoin(companies, eq(companies.id, sectorCompanies.companyId))
    .where(and(eq(sectorCompanies.sectorId, sectorId), isNull(sectorCompanies.removedAt), prospectMembership()))
    .orderBy(companies.id);
}

async function identities(db: DbLike, members: Awaited<ReturnType<typeof activeMembers>>) {
  const ids = members.map(row => row.id);
  const disclosure = await db.select({ companyId: records.companyId, data: records.data }).from(records)
    .where(and(inArray(records.type, ["compliance_disclosure", "iapd_disclosure_snapshot"]), inArray(records.companyId, ids)));
  const secFacts = await db.select({ companyId: facts.companyId, value: facts.valueText }).from(facts)
    .where(and(eq(facts.key, "firm.sec_number"), inArray(facts.companyId, ids), sql`${facts.qualifiers} = '{}'::jsonb`));
  const byId = new Map(members.map(member => {
    const crd = normalizeCrd(member.crd);
    const sec = normalizeSecNumber(member.secNumber);
    return [member.id, { ...member, crds: new Set(crd ? [crd] : []), secNumbers: new Set(sec ? [sec] : []) }];
  }));
  for (const row of disclosure) {
    const firm = byId.get(row.companyId)!;
    const crd = normalizeCrd(row.data.crd ?? row.data.firm_crd);
    const sec = normalizeSecNumber(row.data.sec_number ?? row.data.sec_file_number ?? row.data.sec_full);
    if (crd && !firm.crd) firm.crds.add(crd);
    if (sec && !firm.secNumber) firm.secNumbers.add(sec);
  }
  for (const row of secFacts) {
    const firm = byId.get(row.companyId)!;
    const sec = normalizeSecNumber(row.value);
    if (sec && !firm.secNumber) firm.secNumbers.add(sec);
  }
  return [...byId.values()].map(row => ({ ...row, crds: [...row.crds], secNumbers: [...row.secNumbers] }));
}

export async function snapshotDefinitions(db: DbLike) {
  await db.insert(factKeys).values(SNAPSHOT_FIELDS.map(def => ({
    key: def.key,
    valueType: def.kind === "usd" ? "number" as const : def.kind,
    unit: def.kind === "usd" ? "USD" : null,
    description: `SEC Form ADV Part 1A — ${def.column}`,
    qualifierNames: ["snapshot"],
    status: "provisional" as const,
    createdBy: SNAPSHOT_COLLECTOR,
  }))).onConflictDoNothing();
  await db.update(factKeys).set({ qualifierNames: sql`array_append(${factKeys.qualifierNames}, 'snapshot')` })
    .where(and(inArray(factKeys.key, SNAPSHOT_FIELDS.map(x => x.key)), sql`not ('snapshot' = any(${factKeys.qualifierNames}))`));
  return new Map((await db.select().from(factKeys).where(inArray(factKeys.key, SNAPSHOT_FIELDS.map(def => def.key))))
    .map(row => [row.key, row]));
}

export async function writeSnapshotFacts(db: DbLike, input: {
  evidence: typeof sources.$inferSelect; raw: Record<string, string>; date: string; snapshot: string;
}, definitions: Awaited<ReturnType<typeof snapshotDefinitions>>) {
  const rows = snapshotValues(input.raw).map(field => {
    const def = definitions.get(field.key)!;
    const value = def.valueType === "money" && field.kind === "usd" ? { amount: field.value, currency: "USD" } : field.value;
    return {
      ...validateTypedValue(def.valueType, value, field.key),
      id: randomUUID(), companyId: input.evidence.companyId, runId: input.evidence.runId,
      key: field.key, area: def.area, unit: def.unit ?? (field.kind === "usd" ? "USD" : null),
      qualifiers: { snapshot: input.snapshot }, asOf: input.date, sourceIds: [input.evidence.id],
      confidence: "high" as const, verification: "verified" as const, createdBy: SNAPSHOT_COLLECTOR,
    };
  });
  if (rows.length) {
    await db.insert(facts).values(rows);
    await db.update(factKeys).set({ useCount: sql`${factKeys.useCount} + 1`, firstUsedAt: sql`coalesce(${factKeys.firstUsedAt}, now())` })
      .where(inArray(factKeys.key, rows.map(row => row.key)));
  }
  return rows.length;
}

export async function importSnapshot(db: Db, input: {
  sectorId: string; path: string; snapshotDate: string; sourceUrl: string; dryRun?: boolean; companyIds?: string[];
}) {
  if (!isValidDateString(input.snapshotDate)) throw new DomainError("invalid_input", "snapshotDate must be YYYY-MM-DD");
  const [path] = await checkImportPaths([input.path], getImportDirs(), SEC_MAX_FILE_BYTES);
  const buffer = await readFile(path!);
  const digest = createHash("sha256").update(buffer).digest("hex");
  const zipped = buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex"));
  const extracted = zipped ? extractSecCsv(buffer) : { text: decodeSecCsv(buffer), csvName: basename(path!) };
  const parsed = parseSecCsv(extracted.text);
  const rows = parsed.rows.filter(row => normalizeCrd(row.crd) && !/exempt/i.test(row.firmType ?? ""));
  if (rows.length === 0) throw new DomainError("file_error", "no registered adviser rows");
  const members = await activeMembers(db, input.sectorId);
  const allFirmIdentities = await identities(db, members);
  const selected = input.companyIds && new Set(input.companyIds);
  if (selected && members.filter(member => selected.has(member.id)).length !== selected.size) {
    throw new DomainError("invalid_input", "selected companies must be active sector members");
  }
  const typed = await db.select({ id: companies.id, crd: companies.secCrd }).from(companies)
    .where(inArray(companies.secCrd, rows.map(row => normalizeCrd(row.crd)!)));
  const owners = new Map(typed.map(row => [row.crd!, row.id]));
  const { matches: allMatches, unmatched: allUnmatched, ambiguous: allAmbiguous } = matchSnapshot(allFirmIdentities, rows, owners);
  const matches = allMatches.filter(match => !selected || selected.has(match.companyId));
  const unmatched = allUnmatched.filter(row => !selected || selected.has(row.companyId));
  const ambiguous = allAmbiguous.filter(row => !selected || selected.has(row.companyId));
  const snapshot = input.snapshotDate.slice(0, 7);
  const candidates = matches.filter(match => match.method === "name_state").map(match => ({
    companyId: match.companyId, secName: match.row.name ?? match.row.legalName,
  }));
  const counts = {
    crd: matches.filter(m => m.method === "crd").length,
    secNumber: matches.filter(m => m.method === "sec_number").length,
    unverified: candidates.length, unmatched: unmatched.length, ambiguous: ambiguous.length,
    missingFilingDate: matches.filter(m => m.method !== "name_state" && !snapshotDate(m.row)).length,
    facts: matches.reduce((n, m) => n + (m.method !== "name_state" && snapshotDate(m.row) ? snapshotValues(m.row.raw).length : 0), 0),
  };
  if (input.dryRun !== false) return { counts, candidates };

  const filename = new URL(input.sourceUrl).pathname.split("/").pop() || basename(path!);
  const file = await db.transaction(tx => canonicalFile(tx, {
    collector: SNAPSHOT_COLLECTOR, release: snapshot, url: input.sourceUrl,
    filename, digest, member: extracted.csvName,
  }));
  const definitions = await db.transaction(async tx => {
    await lockEvidence(tx, "sec-adv-snapshot-definitions");
    return snapshotDefinitions(tx);
  });
  let written = 0;
  for (const match of matches) {
    const crd = normalizeCrd(match.row.crd)!;
    const date = snapshotDate(match.row);
    if (match.method !== "name_state" && !date) continue;
    written += await db.transaction(async tx => {
      await lockEvidence(tx, `company:${match.companyId}`);
      const [company] = await tx.select({ crd: companies.secCrd }).from(companies).where(eq(companies.id, match.companyId));
      if (!company || (company.crd && normalizeCrd(company.crd) !== crd)) {
        throw new DomainError("conflict", `company identity changed during import: ${match.companyId}`);
      }
      const [existing] = await tx.select({ id: sources.id }).from(sources).where(and(
        eq(sources.companyId, match.companyId), eq(sources.collector, SNAPSHOT_COLLECTOR),
        sql`${sources.details}->>'fileSourceId' = ${file.id}`,
        sql`${sources.details}->>'verification' = ${match.method === "name_state" ? "unverified" : "verified"}`,
      ));
      if (existing) return 0;
      const evidence = await companyFileEvidence(tx, file, match.companyId, {
        crd, filingDate: date, method: match.method, row: match.row.rowNumber,
        verification: match.method === "name_state" ? "unverified" : "verified",
      });
      if (match.method === "name_state") {
        const result = await upsertRecords(tx, { companyId: match.companyId, runId: evidence.runId, createdBy: SNAPSHOT_COLLECTOR, records: [{
          type: CANDIDATE_TYPE, sourceIds: [evidence.id], naturalKey: ["snapshot", "crd"],
          data: { snapshot, crd, sec_name: match.row.name ?? match.row.legalName ?? "", status: "unverified" },
        }] });
        if (!result[0]?.ok) throw new Error("could not save unverified CRD candidate");
        return 0;
      }
      if (!company.crd) await tx.update(companies).set({ secCrd: crd }).where(eq(companies.id, match.companyId));
      return writeSnapshotFacts(tx, { evidence, raw: match.row.raw, date: date!, snapshot }, definitions);
    });
  }
  if (!selected) {
    const diagnostic = {
      unmatched, ambiguous,
      missingFilingDate: matches.filter(match => match.method !== "name_state" && !snapshotDate(match.row)).map(match => match.companyId),
    };
    const json = JSON.stringify(diagnostic);
    await db.update(sources).set({
      details: sql`jsonb_set(${sources.details}, '{matchReports}',
        coalesce(${sources.details}->'matchReports', '{}'::jsonb) || jsonb_build_object(${input.sectorId}::text, ${json}::jsonb))`,
    }).where(and(eq(sources.id, file.id), sql`${sources.details}->'matchReports'->${input.sectorId}::text is distinct from ${json}::jsonb`));
  }
  return { counts, candidates, written, unmatched, ambiguous, sourceId: file.id };
}

function snapshotDate(row: SecCompany): string | null {
  const value = row.raw["Latest ADV Filing Date"]?.trim() ?? "";
  return row.filingDate ?? (isValidDateString(value) ? value : null);
}
