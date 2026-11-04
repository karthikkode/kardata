import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sources } from "../../db/schema.js";
import { getImportDirs } from "../../lib/env.js";
import { forEachZipCsv, zipMembers } from "../../lib/sec/archive.js";
import { parseMoneyField, parseSecDate } from "../../lib/sec/parse.js";
import { DomainError } from "../errors.js";
import { checkImportPaths } from "../imports.js";
import { upsertRecords, type UpsertRecordItem } from "../research/records.js";
import { isValidDateString } from "../research/validate.js";
import { canonicalFile, companyFileEvidence, lockEvidence, SCHEDULE_COLLECTOR, SNAPSHOT_COLLECTOR } from "./evidence.js";
import { advBoolean, SNAPSHOT_FIELDS } from "./fields.js";
import { activeMembers, normalizeCrd, snapshotDefinitions, writeSnapshotFacts } from "./snapshot.js";

const CUTOFF = "2024-12-31";
const HISTORY = "20111105_20241231";
type Row = Record<string, string>;
type Filing = { id: string; crd: string; date: string; time: number; base: Row; baseB?: Row };
type Section = "owners" | "offices" | "websites" | "sma" | "affiliates";
const TABLES = [
  { section: "owners", part: 0, name: "IA_Schedule_A_B", headers: ["FilingID", "Schedule", "Full Legal Name", "Ownership Code"] },
  { section: "offices", part: 0, name: "IA_Schedule_D_1F", headers: ["FilingID", "State"] },
  { section: "websites", part: 0, name: "IA_Schedule_D_1I", headers: ["FilingID", "Website"] },
  { section: "sma", part: 1, name: "IA_Schedule_D_5K3", headers: ["Filing ID", "5K(3)(a)", "5K(3)(g)"] },
  { section: "affiliates", part: 1, name: "IA_Schedule_D_7A", headers: ["FilingID", "Legal Name", "Custodian"] },
] as const;

const clean = (row: Row, key: string) => row[key]?.trim() || null;
const absent = (value: string | null) => value === null || /^(?:n\/?a|none)$/i.test(value);

export function filingDate(value: string | undefined) {
  const [day, clock, meridiem] = value?.trim().split(/\s+/) ?? [];
  const date = parseSecDate(day);
  if (!date) return null;
  const [h = 0, m = 0, s = 0] = (clock ?? "").split(":").map(Number);
  const hour = meridiem ? h % 12 + (meridiem.toUpperCase() === "PM" ? 12 : 0) : h;
  return { date, time: hour * 3600 + m * 60 + s };
}

export function selectFiling(selected: Map<string, Filing>, row: Row, crds: Set<string>, cutoff: string) {
  const crd = normalizeCrd(row["1E1"]);
  const id = clean(row, "FilingID");
  const stamp = filingDate(row["DateSubmitted"]);
  if (!crd || !id || !crds.has(crd) || !stamp || stamp.date > cutoff) return;
  const current = selected.get(crd);
  if (!current || stamp.date > current.date ||
      (stamp.date === current.date && (stamp.time > current.time ||
        (stamp.time === current.time && id.localeCompare(current.id, "en", { numeric: true }) > 0)))) {
    selected.set(crd, { id, crd, ...stamp, base: row });
  }
}

const ownerRanges: Record<string, string> = {
  NA: "under 5%", A: "5% to under 10%", B: "10% to under 25%", C: "25% to under 50%",
  D: "50% to under 75%", E: "75% or more", F: "other ownership status",
};

function ownerRows(rows: Row[]) {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const name = clean(row, "Full Legal Name");
    const schedule = clean(row, "Schedule");
    if (!name || (schedule !== "A" && schedule !== "B")) return [];
    const code = clean(row, "Ownership Code")?.toUpperCase();
    const kind = clean(row, "DE/FE/I");
    const through = clean(row, "Entity in Which");
    const ownerId = clean(row, "OwnerID") ?? name.toLowerCase();
    const key = JSON.stringify([schedule, ownerId, through]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      owner_key: key, schedule, name, through, role: clean(row, "Title or Status"),
      acquired: clean(row, "Status Acquired"), ownership_code: code ?? null,
      ownership_range: code ? ownerRanges[code] ?? null : null,
      control: advBoolean(row["Control Person"]),
      entity_type: kind === "DE" ? "domestic_entity" : kind === "FE" ? "foreign_entity" : kind === "I" ? "individual" : null,
      ownership_reported: code && code !== "NA" ? true : code === "NA" ? false : null,
    }];
  });
}

export function scheduleValues(filing: Filing, tables: Partial<Record<Section, Row[]>>) {
  const owners = ownerRows(tables.owners ?? []);
  const byName = new Map<string, { name: string; sections: string[]; amount: number | null; sharePct: number | null }>();
  const keyFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dollars = parseMoneyField(filing.base["5F2c"]);
  const pooled = ["5D3d", "5D3e", "5D3f"].map(key => parseMoneyField(filing.base[key]));
  const denominator = dollars !== null && pooled.every(value => value !== null && value >= 0)
    ? dollars - pooled.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  for (const row of tables.sma ?? []) {
    const name = clean(row, "5K(3)(a)") ?? clean(row, "5K(3)(b)");
    if (!name) continue;
    const amount = parseMoneyField(row["5K(3)(g)"]);
    const sharePct = amount !== null && denominator && denominator > 0 && amount >= 0 && amount <= denominator
      ? amount / denominator * 100 : null;
    byName.set(keyFor(name), { name, sections: ["5.K.(3)"], amount, sharePct });
  }
  for (const row of tables.affiliates ?? []) {
    if (advBoolean(row["Custodian"]) !== true || /^d(?:elete)?$/i.test(row["Type"]?.trim() ?? "")) continue;
    const name = clean(row, "Legal Name") ?? clean(row, "Business Name");
    if (!name) continue;
    const key = keyFor(name);
    const existing = byName.get(key);
    if (!existing) byName.set(key, { name, sections: ["7.A"], amount: null, sharePct: null });
    else if (!existing.sections.includes("7.A")) existing.sections.push("7.A");
  }
  const offices: Record<string, number> = {};
  for (const row of tables.offices ?? []) {
    const state = clean(row, "State")?.toUpperCase();
    if (state && /^[A-Z]{2}$/.test(state)) offices[state] = (offices[state] ?? 0) + 1;
  }
  const websites = [...new Set((tables.websites ?? []).flatMap(row => {
    const value = clean(row, "Website");
    if (absent(value)) return [];
    try {
      const url = new URL(/^[a-z][\w+.-]*:/i.test(value!) ? value! : `https://${value}`);
      return url.hostname.includes(".") && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? [url.href] : [];
    } catch {
      return [];
    }
  }))];
  const custodianRows = [...byName.values()];
  return {
    owners, offices, websites, custodians: custodianRows, custodian_count: custodianRows.length,
    outside_entity_ownership: owners.some(owner => owner.entity_type?.endsWith("_entity") && owner.ownership_reported) ? true :
      owners.length && owners.every(owner => owner.entity_type === "individual") ? false : null,
    related_person_amendments: (tables.affiliates ?? []).some(row => /^(?:a|d|amend|delete)$/i.test(row["Type"]?.trim() ?? "")),
  };
}

function historyColumns(filing: Filing) {
  const rows = { ...filing.base, ...filing.baseB };
  const names: Record<string, string> = {
    "Latest ADV Filing Date": "DateSubmitted", "SEC#": "1D", "Main Office State": "1F1-State",
    "Main Office Private Residence Flag": "1F1-Private", "Total number of offices, other than your Principal Office and place of business": "1F5",
    "5H-If more than 500, how many": "5H-Over500",
  };
  const raw: Row = { "Latest ADV Filing Date": filing.date, "Firm Type": "Registered" };
  const monthlyColumns = SNAPSHOT_FIELDS.map(field => field.column);
  for (const letter of "abcdefghijklmn") monthlyColumns.push(`5D(${letter})(2)`);
  for (const column of monthlyColumns) {
    if (column in raw) continue;
    const client = /^5D\(([a-n])\)\(([123])\)$/.exec(column);
    const name = names[column] ?? (client ? `5D${client[2]}${client[1]}` : column.replace(/[()]/g, ""));
    const value = rows[name] ?? rows[column];
    if (value !== undefined) raw[column] = value;
  }
  return raw;
}

async function fileDigest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function importSchedules(db: Db, input: {
  sectorId: string; part1Path: string; part2Path: string; part1Url: string; part2Url: string;
  dryRun?: boolean; companyIds?: string[]; snapshotDate?: string;
}) {
  const cutoff = input.snapshotDate ?? CUTOFF;
  if (!isValidDateString(cutoff) || cutoff > CUTOFF) throw new DomainError("invalid_input", "history cutoff must be on or before 2024-12-31");
  const members = await activeMembers(db, input.sectorId);
  const wanted = input.companyIds && new Set(input.companyIds);
  const selected = wanted ? members.filter(row => wanted.has(row.id)) : members;
  if (wanted && wanted.size !== selected.length) throw new DomainError("invalid_input", "selected companies must be active sector members");
  const byCrd = new Map(selected.flatMap(row => {
    const crd = normalizeCrd(row.crd);
    return crd ? [[crd, row.id] as const] : [];
  }));
  const paths = await checkImportPaths([input.part1Path, input.part2Path], getImportDirs(), 2 * 1024 ** 3);
  const archives = await Promise.all(paths.map(zipMembers));
  const member = (part: number, table: string) => {
    const found = archives[part]?.filter(entry => entry.name.split("/").at(-1) === `${table}_${HISTORY}.csv`) ?? [];
    if (found.length > 1) throw new DomainError("file_error", `duplicate archive member: ${table}`);
    return found[0];
  };
  const base = member(0, "IA_ADV_Base_A");
  if (!base) throw new DomainError("file_error", "missing IA_ADV_Base_A in part 1");
  const filings = new Map<string, Filing>();
  const crds = new Set(byCrd.keys());
  await forEachZipCsv(paths[0]!, base, row => selectFiling(filings, row, crds, cutoff), ["FilingID", "DateSubmitted", "1E1"]);
  const byFiling = new Map([...filings.values()].map(filing => [filing.id, filing]));
  const baseB = member(0, "IA_ADV_Base_B");
  if (input.snapshotDate && baseB) await forEachZipCsv(paths[0]!, baseB, row => {
    const filing = byFiling.get(row["FilingID"]!);
    if (filing) filing.baseB = row;
  }, ["FilingID"]);
  const byTable = new Map<string, Partial<Record<Section, Row[]>>>();
  const missingTables: string[] = [];
  for (const table of TABLES) {
    const entry = member(table.part, table.name);
    if (!entry) { missingTables.push(table.name); continue; }
    if (input.snapshotDate) continue;
    await forEachZipCsv(paths[table.part]!, entry, row => {
      const id = row["FilingID"] ?? row["Filing ID"];
      if (!id || !byFiling.has(id)) return;
      const tables = byTable.get(id) ?? {};
      (tables[table.section] ??= []).push(row);
      byTable.set(id, tables);
    }, [...table.headers]);
  }
  const counts = { matched: filings.size, missing: selected.length - filings.size, missingTables, written: 0 };
  if (input.dryRun !== false) return counts;
  const urls = [input.part1Url, input.part2Url];
  const digests = await Promise.all(paths.map(fileDigest));
  const files = await db.transaction(async tx => {
    const result = [];
    for (let index = 0; index < paths.length; index++) {
      const url = urls[index]!;
      result.push(await canonicalFile(tx, {
        collector: input.snapshotDate ? SNAPSHOT_COLLECTOR : SCHEDULE_COLLECTOR,
        release: input.snapshotDate ? (index === 0 ? cutoff.slice(0, 7) : `${cutoff.slice(0, 7)}:history-part2`) : `${CUTOFF}:part${index + 1}`,
        url, filename: new URL(url).pathname.split("/").at(-1)!, digest: digests[index]!,
      }));
    }
    return result;
  });
  const definitions = input.snapshotDate ? await db.transaction(async tx => {
    await lockEvidence(tx, "sec-adv-snapshot-definitions");
    return snapshotDefinitions(tx);
  }) : undefined;
  for (const filing of filings.values()) {
    const companyId = byCrd.get(filing.crd)!;
    counts.written += await db.transaction(async tx => {
      await lockEvidence(tx, `company:${companyId}`);
      const [existing] = await tx.select({ id: sources.id }).from(sources).where(and(eq(sources.companyId, companyId),
        eq(sources.collector, files[0]!.collector), sql`${sources.details}->>'fileSourceId' = ${files[0]!.id}`));
      if (existing) return 0;
      const citations = [];
      for (const file of files) citations.push(await companyFileEvidence(tx, file, companyId, {
        filingId: filing.id, filingDate: filing.date, crd: filing.crd, method: "crd", verification: "verified",
      }));
      const [first, second] = citations;
      if (definitions) {
        return writeSnapshotFacts(tx, { evidence: first!, raw: historyColumns(filing), date: filing.date, snapshot: cutoff.slice(0, 7) }, definitions);
      }
      const values = scheduleValues(filing, byTable.get(filing.id) ?? {});
      const items: UpsertRecordItem[] = values.owners.map(owner => ({
        type: "sec_adv_owner", naturalKey: ["filing_id", "owner_key"], sourceIds: [first!.id],
        data: { ...owner, filing_id: filing.id, filing_date: filing.date },
      }));
      items.push({
        type: "sec_adv_schedules", naturalKey: ["filing_id"], sourceIds: [first!.id, second!.id],
        data: {
          filing_id: filing.id, filing_date: filing.date, archive_through: CUTOFF,
          offices_by_state: values.offices, websites: values.websites, custodians: values.custodians,
          custodian_count: values.custodian_count, outside_entity_ownership: values.outside_entity_ownership,
          related_person_amendments: values.related_person_amendments, missing_tables: missingTables,
          sections_with_rows: Object.keys(byTable.get(filing.id) ?? {}),
        },
      });
      const written = await upsertRecords(tx, { companyId, runId: first!.runId, createdBy: SCHEDULE_COLLECTOR, records: items });
      const failed = written.find(result => !result.ok);
      if (failed && !failed.ok) throw new Error(failed.error);
      return 1;
    });
  }
  return counts;
}
