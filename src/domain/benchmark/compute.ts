import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { facts, factKeys, sources } from "../../db/schema.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import { DomainError } from "../errors.js";
import { findEvidenceLibrary } from "../evidence-library.js";
import { upsertRecords } from "../research/records.js";
import { chunked, isValidDateString } from "../research/validate.js";
import { canonicalFile, lockEvidence, SNAPSHOT_COLLECTOR } from "../sec-adv/evidence.js";
import { activeMembers } from "../sec-adv/snapshot.js";
import { FEE_COLLECTOR } from "./fees.js";
import { deriveMeasures, EMPTY_SNAPSHOT, primaryPeerFees, type Snapshot } from "./measures.js";
import { peerConfig, peerStatistics } from "./peers.js";
import { sectorData } from "./sector-data.js";

export const BENCHMARK_COLLECTOR = "benchmark_compute";
export const BENCHMARK_MEASURES_KEY = "benchmark.measures";
const formula = {
  growth: "(current / prior − 1) × 100",
  non_advisory_staff: "staff minus advisory staff",
  estimated_annual_fee_revenue: "regulatory AUM × effective annual fee at AUM / accounts",
  estimated_fee_revenue_per_staff: "estimated annual fee revenue / staff",
  percentile: "(count below + count tied / 2) / non-null sample × 100",
  fee_percentile: "single-reading primary fees only; two-reading endpoints ranked against that sample",
};

const FIELDS: Record<string, Exclude<keyof Snapshot, "filingDate">> = {
  "firm.client_total": "clients", "firm.accounts": "accounts", "financials.employees": "staff",
  "sec_adv.advisory_staff": "advisoryStaff", "firm.regulatory_aum": "aum",
  "firm.client_individuals": "individualClients", "firm.client_hnw": "hnwClients",
  "sec_adv.aum_individuals": "individualAum", "sec_adv.aum_hnw": "hnwAum",
};

type Windows = { current: string; prior1: string; prior2?: string; prior3: string };
type SnapshotData = { data: Snapshot; sourceIds: Set<string> };

export function monthStart(month: string) {
  return /^\d{4}-\d\d$/.test(month) && isValidDateString(`${month}-01`) ? `${month}-01` : null;
}

export async function computeBenchmark(db: Db, input: { sectorId: string; formulaVersion: string; snapshots: Windows }) {
  const { sectorId, formulaVersion, snapshots } = input;
  const months = [snapshots.prior3, snapshots.prior2, snapshots.prior1, snapshots.current].filter((month): month is string => !!month);
  if (months.some((month, i) => !monthStart(month) || (i > 0 && month <= months[i - 1]!))) {
    throw new DomainError("invalid_input", "snapshot months must be valid and chronologically ordered");
  }
  const config = peerConfig.parse(await sectorData(db, sectorId, "benchmark-peers.json"));
  const library = await findEvidenceLibrary(db);
  if (!library) throw new DomainError("invalid_input", "run evidence_library_ensure first");
  const members = await activeMembers(db, sectorId);
  if (!members.length) throw new DomainError("invalid_input", "the benchmark cohort is empty");
  const ids = members.map(row => row.id);
  const canonical = await db.select().from(sources).where(and(eq(sources.companyId, library.companyId),
    eq(sources.collector, SNAPSHOT_COLLECTOR), inArray(sql<string>`${sources.details}->>'release'`, months)));
  const currentSource = canonical.find(row => row.details?.release === snapshots.current);
  if (!currentSource) throw new DomainError("invalid_input", "import the current snapshot before computing benchmarks");

  const snapshotMonth = sql<string>`${facts.qualifiers}->>'snapshot'`;
  const snapshotRows = await db.selectDistinctOn([facts.companyId, facts.key, snapshotMonth]).from(facts)
    .where(and(eq(facts.createdBy, SNAPSHOT_COLLECTOR), eq(facts.verification, "verified"),
      inArray(facts.companyId, ids), inArray(facts.key, [...Object.keys(FIELDS), "firm.filing_date"]), inArray(snapshotMonth, months)))
    .orderBy(facts.companyId, facts.key, snapshotMonth, desc(facts.createdAt), desc(facts.id));
  const feeStatuses = await db.selectDistinctOn([facts.companyId]).from(facts)
    .where(and(eq(facts.createdBy, FEE_COLLECTOR), eq(facts.key, "fee_schedule.status"), inArray(facts.companyId, ids)))
    .orderBy(facts.companyId, desc(facts.createdAt), desc(facts.id));
  const feeRows = await db.select().from(facts).where(and(eq(facts.createdBy, FEE_COLLECTOR),
    eq(facts.key, "firm.fee_schedule"), inArray(facts.companyId, ids)));
  const feesByInput = new Map(feeRows.map(row => [`${row.companyId}:${row.qualifiers.input}`, row]));
  const feesByFirm = new Map(feeStatuses.map(status => [
    status.companyId, { status, fee: status.valueText === "available" ? feesByInput.get(`${status.companyId}:${status.qualifiers.input}`) : undefined },
  ]));
  const byFirmMonth = new Map<string, SnapshotData>();
  for (const row of snapshotRows) {
    const key = `${row.companyId}:${row.qualifiers.snapshot}`;
    const entry = byFirmMonth.get(key) ?? { data: { ...EMPTY_SNAPSHOT }, sourceIds: new Set<string>() };
    const field = FIELDS[row.key];
    if (field && row.valueNum !== null && Number.isFinite(Number(row.valueNum))) entry.data[field] = Number(row.valueNum);
    if (row.asOf) entry.data.filingDate = row.asOf;
    for (const id of row.sourceIds) entry.sourceIds.add(id);
    byFirmMonth.set(key, entry);
  }
  const revision = createHash("sha256")
    .update(JSON.stringify({ sectorId, formulaVersion, months, config, ids, feePeerVersion: 3 }))
    .update(snapshotRows.map(row => row.id).join(","))
    .update(feeStatuses.map(row => row.id).join(","))
    .update(feeStatuses.map(row => feesByFirm.get(row.companyId)?.fee?.id ?? "").join(","))
    .digest("hex").slice(0, 24);
  const results = ids.map(id => {
    const pick = (month: string) => byFirmMonth.get(`${id}:${month}`);
    const current = pick(snapshots.current)?.data ?? EMPTY_SNAPSHOT;
    const chronological = months.map(month => pick(month)?.data ?? EMPTY_SNAPSHOT);
    const fee = feesByFirm.get(id);
    const result = deriveMeasures(current, pick(snapshots.prior1)?.data ?? EMPTY_SNAPSHOT, pick(snapshots.prior3)?.data ?? EMPTY_SNAPSHOT,
      primaryPeerFees(fee?.fee?.valueJson ?? null), snapshots.current, chronological);
    return {
      id, staff: current.staff, aum: current.aum, ...result, filingDate: current.filingDate,
      dates: Object.fromEntries(months.map((month, index) => [month, chronological[index]!.filingDate])),
      feeDate: fee?.fee?.asOf ?? null,
      sourceIds: [...new Set([...months.flatMap(month => [...(pick(month)?.sourceIds ?? [])]), ...(fee?.status.sourceIds ?? []), ...(fee?.fee?.sourceIds ?? [])])],
    };
  });
  const peers = peerStatistics(results, config);
  return db.transaction(async tx => {
    await lockEvidence(tx, `benchmark:${sectorId}:${revision}`);
    const [existing] = await tx.select({ id: sources.id }).from(sources).where(and(eq(sources.companyId, library.companyId),
      eq(sources.collector, BENCHMARK_COLLECTOR), sql`${sources.details}->>'release' = ${revision}`));
    if (existing) return { revision, cohort: results.length, written: 0, peerSummaries: peers.summaries.length };
    const summarySource = await canonicalFile(tx, {
      collector: BENCHMARK_COLLECTOR, release: revision, url: currentSource.url,
      filename: `Benchmark computation ${formulaVersion}`, digest: revision,
    });
    await tx.update(sources).set({ details: { ...summarySource.details, sourceIds: canonical.map(source => source.id), snapshots, sectorId, formulaVersion, formula } })
      .where(eq(sources.id, summarySource.id));
    const peerWrites = await upsertRecords(tx, {
      companyId: library.companyId, runId: summarySource.runId, createdBy: BENCHMARK_COLLECTOR,
      records: peers.summaries.map(summary => ({
        type: "benchmark_peer_measure", naturalKey: ["revision", "group_key", "measure"], sourceIds: [summarySource.id, ...canonical.map(row => row.id)],
        data: { revision, group_key: summary.key, measure: summary.measure, sector_id: sectorId,
          formula_version: formulaVersion, snapshots, summary },
      })),
    });
    const failed = peerWrites.find(row => !row.ok);
    if (failed && !failed.ok) throw new Error(failed.error);

    await tx.insert(factKeys).values({
      key: BENCHMARK_MEASURES_KEY, valueType: "json", description: "Dated company measures and peer percentiles",
      qualifierNames: ["formula", "snapshot", "revision"], status: "provisional", createdBy: BENCHMARK_COLLECTOR,
    }).onConflictDoNothing();
    for (const batch of chunked(results, 250)) {
      const toWrite: (typeof facts.$inferInsert)[] = [];
      for (const firm of batch) {
        if (!firm.sourceIds.length) {
          const id = randomUUID();
          await tx.insert(sources).values({
            id, companyId: firm.id, runId: await getOrCreateManualRun(tx, firm.id), url: currentSource.url,
            finalUrl: currentSource.finalUrl, collector: BENCHMARK_COLLECTOR, status: "not_found",
            error: "No verified benchmark input for this company", details: { benchmarkSourceId: summarySource.id },
          });
          firm.sourceIds.push(id);
        }
        toWrite.push({
          id: randomUUID(), companyId: firm.id, key: BENCHMARK_MEASURES_KEY, createdBy: BENCHMARK_COLLECTOR,
          qualifiers: { formula: formulaVersion, snapshot: snapshots.current, revision },
          asOf: firm.filingDate, sourceIds: firm.sourceIds, confidence: "high", verification: "verified_value",
          valueJson: {
            values: firm.values, flags: firm.flags, jumps: firm.jumps, gapReasons: firm.gapReasons, feeRanges: firm.feeRanges, dates: firm.dates, feeDate: firm.feeDate,
            peer: peers.memberGroups.get(firm.id) ?? null, summarySourceId: summarySource.id, formula,
          },
        });
      }
      await tx.insert(facts).values(toWrite);
    }
    await tx.update(factKeys).set({ useCount: sql`${factKeys.useCount} + ${results.length}`,
      firstUsedAt: sql`coalesce(${factKeys.firstUsedAt}, now())` }).where(eq(factKeys.key, BENCHMARK_MEASURES_KEY));
    return { revision, cohort: results.length, written: results.length, peerSummaries: peers.summaries.length };
  });
}
