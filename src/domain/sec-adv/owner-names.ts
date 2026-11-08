import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbLike } from "../../db/client.js";
import { companies, records, sectorCompanies, sources } from "../../db/schema.js";
import { getImportDirs } from "../../lib/env.js";
import { forEachZipCsv, zipMembers } from "../../lib/sec/archive.js";
import { checkImportPaths } from "../imports.js";
import { DomainError } from "../errors.js";
import { upsertRecords, type UpsertRecordItem } from "../research/records.js";
import { activeMembers, normalizeCrd } from "./snapshot.js";
import { selectFiling, type Filing } from "./schedules.js";
import { canonicalFile, companyFileEvidence, lockEvidence } from "./evidence.js";
import { advBoolean } from "./fields.js";
import { FILING_LABEL, FILING_NAMES_STATUS, FILING_PEOPLE, formatFiledName, OWNERSHIP_RANGES } from "./contact-people.js";

const COLLECTOR = "sec_schedule_a_contacts";
type Row = Record<string, string>;
const clean = (row: Row, key: string) => row[key]?.trim() ?? "";

/** Only explicitly reported individuals in Schedule A. Never retain OwnerID (may be sensitive). */
export function scheduleAPeople(rows: Row[]) {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    if (clean(row, "Schedule").toUpperCase() !== "A" || clean(row, "DE/FE/I").toUpperCase() !== "I") return [];
    const rawName = clean(row, "Full Legal Name");
    if (!rawName) return [];
    const name = formatFiledName(rawName);
    const title = clean(row, "Title or Status");
    const code = clean(row, "Ownership Code").toUpperCase();
    // One person can have several reported statuses; preserve each distinct row.
    const personKey = createHash("sha256").update(JSON.stringify([name.toLowerCase(), title.toLowerCase()])).digest("hex");
    if (seen.has(personKey)) return [];
    seen.add(personKey);
    return [{ name, raw_name: rawName, title, person_key: personKey, entity_type: "individual",
      ownership_code: code || null, ownership_range: OWNERSHIP_RANGES[code] ?? null,
      control_person: advBoolean(row["Control Person"]), source: "SEC Form ADV Schedule A",
      verification: "unconfirmed_public_filing", uncertainty: FILING_LABEL }];
  });
}

export async function ownerNamesMembers(db: Db, sectorId: string) {
  await activeMembers(db, sectorId); // Validate sector and exclude the evidence library.
  return db.select({ companyId: companies.id, crd: companies.secCrd, decision: sectorCompanies.riaDecision,
    tier: sectorCompanies.riaTier }).from(sectorCompanies).innerJoin(companies, eq(companies.id, sectorCompanies.companyId))
    .where(and(eq(sectorCompanies.sectorId, sectorId), isNull(sectorCompanies.removedAt),
      eq(companies.evidenceLibrary, false), inArray(sectorCompanies.riaDecision, ["Accept", "Hold"]))).orderBy(companies.id);
}

async function writeNames(db: DbLike, companyId: string, file: typeof sources.$inferSelect, input: {
  crd: string | null; filing?: Filing; rows: Row[]; reason: string | null;
}) {
  await lockEvidence(db, `schedule-a-contacts:${companyId}`);
  const [existing] = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.companyId, companyId),
    eq(sources.collector, COLLECTOR), sql`${sources.details}->>'fileSourceId' = ${file.id}`));
  // Each source/file pair is immutable; reruns create no sources, records or manual runs.
  if (existing) return false;
  const evidence = await companyFileEvidence(db, file, companyId, {
    crd: input.crd, method: "stored_crd", filingId: input.filing?.id ?? null, filingDate: input.filing?.date ?? null,
    verification: "unconfirmed_public_filing", uncertainty: FILING_LABEL,
  });
  const shared = { filing_id: input.filing?.id ?? "", filing_date: input.filing?.date ?? "", crd: input.crd,
    dataset: file.details?.digest, source_url: file.url };
  const people = scheduleAPeople(input.rows);
  // Filed rows are append-only even across different archives. A later archive
  // cannot rewrite a record an operator has since confirmed or corrected.
  const stored = await db.select({ data: records.data }).from(records).where(and(eq(records.companyId, companyId), eq(records.type, FILING_PEOPLE)));
  const keys = new Set(stored.map(r => JSON.stringify([r.data.filing_id, r.data.person_key])));
  const items: UpsertRecordItem[] = people.filter(person => !keys.has(JSON.stringify([shared.filing_id, person.person_key]))).map(person => ({ type: FILING_PEOPLE,
    naturalKey: ["filing_id", "person_key"], sourceIds: [evidence.id], data: { ...person, ...shared } }));
  items.push({ type: FILING_NAMES_STATUS, naturalKey: ["dataset"], sourceIds: [evidence.id], data: {
    ...shared, reason: input.reason, people: people.length, source: "SEC Form ADV Schedule A",
    verification: "unconfirmed_public_filing", uncertainty: FILING_LABEL,
  } });
  const results = await upsertRecords(db, { companyId, runId: evidence.runId, createdBy: COLLECTOR, records: items });
  const failed = results.find(r => !r.ok);
  if (failed && !failed.ok) throw new Error(failed.error);
  return true;
}

export async function importOwnerNames(db: Db, input: {
  sectorId: string; path: string; sourceUrl: string; dryRun?: boolean;
}) {
  const members = await ownerNamesMembers(db, input.sectorId);
  const [path] = await checkImportPaths([input.path], [...getImportDirs(), resolve("var/sources/sec")], 2 * 1024 ** 3);
  const entries = await zipMembers(path!);
  const member = (table: string) => {
    const found = entries.filter(e => new RegExp(`^${table}_\\d{8}_\\d{8}\\.csv$`).test(e.name.split("/").at(-1)!));
    if (found.length !== 1) throw new DomainError("file_error", `expected one ${table} CSV`);
    return found[0]!;
  };
  const filings = new Map<string, Filing>();
  const crds = new Set(members.flatMap(m => normalizeCrd(m.crd) ? [normalizeCrd(m.crd)!] : []));
  const parsing = [await forEachZipCsv(path!, member("IA_ADV_Base_A"), row => selectFiling(filings, row, crds, "9999-12-31"),
    ["FilingID", "DateSubmitted", "1E1"])];
  const ids = new Set([...filings.values()].map(f => f.id));
  const rows = new Map<string, Row[]>();
  parsing.push(await forEachZipCsv(path!, member("IA_Schedule_A_B"), row => {
    if (!ids.has(row["FilingID"]!) || clean(row, "Schedule").toUpperCase() !== "A") return;
    const group = rows.get(row["FilingID"]!) ?? [];
    group.push(row); rows.set(row["FilingID"]!, group);
  }, ["FilingID", "Schedule", "Full Legal Name", "DE/FE/I", "Title or Status", "Ownership Code", "Control Person"]));
  const selected = members.map(m => {
    const crd = normalizeCrd(m.crd);
    const filing = crd ? filings.get(crd) : undefined;
    const owners = filing ? rows.get(filing.id) ?? [] : [];
    const people = scheduleAPeople(owners);
    const reason = !crd ? "missing_stored_crd" : !filing ? "no_filing_in_archive" : !owners.length ? "no_schedule_a_rows" :
      !people.length ? "no_named_individuals_in_schedule_a" : null;
    return { ...m, crd, filing, rows: owners, reason, people: people.length };
  });
  const result = { firms: members.length, withNames: selected.filter(m => m.people > 0).length,
    people: selected.reduce((n, m) => n + m.people, 0), missing: selected.filter(m => m.reason).length,
    written: 0, unchanged: 0, parsing };
  if (input.dryRun !== false) return result;
  if (parsing.some(p => p.rejected > 0)) throw new DomainError("file_error", "archive contains rejected CSV rows; no contacts imported");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path!)) hash.update(chunk as Buffer);
  const digest = hash.digest("hex");
  const file = await db.transaction(tx => canonicalFile(tx, { collector: COLLECTOR, release: digest,
    url: input.sourceUrl, filename: new URL(input.sourceUrl).pathname.split("/").at(-1)!, digest }));
  for (const m of selected) {
    const written = await db.transaction(tx => writeNames(tx, m.companyId, file, m));
    if (written) result.written++; else result.unchanged++;
  }
  return result;
}

/** Counts include unconfirmed historical names; this never makes a firm contactable. */
export async function ownerNamesCoverage(db: Db, input: { sectorId: string; tier?: number; missingOnly?: boolean; offset?: number; limit?: number }) {
  let members = await ownerNamesMembers(db, input.sectorId);
  if (input.tier !== undefined) members = members.filter(m => m.tier === input.tier && m.decision === "Accept");
  const statuses = new Map<string, Record<string, unknown>>();
  for (let start = 0; start < members.length; start += 500) {
    const batch = await db.select({ companyId: records.companyId, data: records.data }).from(records).where(and(
      inArray(records.companyId, members.slice(start, start + 500).map(m => m.companyId)), eq(records.type, FILING_NAMES_STATUS)));
    for (const row of batch) {
      const existing = statuses.get(row.companyId);
      if (!existing || String(row.data.filing_date) > String(existing.filing_date) ||
        (row.data.filing_date === existing.filing_date && String(row.data.filing_id).localeCompare(String(existing.filing_id), "en", { numeric: true }) > 0)) statuses.set(row.companyId, row.data);
    }
  }
  const groups: Record<string, { firms: number; withNames: number; missing: number; reasons: Record<string, number>; filingYears: Record<string, number> }> = {};
  const items = members.map(m => {
    const status = statuses.get(m.companyId);
    const people = Number(status?.people ?? 0);
    const reason = status ? status.reason as string | null : "not_imported";
    const group = m.decision === "Hold" ? "Hold" : `Tier ${m.tier}`;
    const count = groups[group] ??= { firms: 0, withNames: 0, missing: 0, reasons: {}, filingYears: {} };
    count.firms++; if (people > 0) count.withNames++; else count.missing++;
    if (reason) count.reasons[reason] = (count.reasons[reason] ?? 0) + 1;
    const year = String(status?.filing_date ?? "").slice(0, 4) || "missing";
    count.filingYears[year] = (count.filingYears[year] ?? 0) + 1;
    return { companyId: m.companyId, crd: m.crd, decision: m.decision, tier: m.tier, people, reason,
      filingId: status?.filing_id ?? null, filingDate: status?.filing_date ?? null };
  }).filter(m => !input.missingOnly || m.people === 0);
  return { total: items.length, groups, items: items.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 100)) };
}
