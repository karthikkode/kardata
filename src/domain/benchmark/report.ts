import { and, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import { WEBSITE_SCAN_TYPE } from "../../collect/collectors/website-software.js";
import type { Db } from "../../db/client.js";
import { facts, records, sources } from "../../db/schema.js";
import { findEvidenceLibrary } from "../evidence-library.js";
import { SNAPSHOT_COLLECTOR } from "../sec-adv/evidence.js";
import { SNAPSHOT_FIELDS } from "../sec-adv/fields.js";
import { activeMembers } from "../sec-adv/snapshot.js";
import { BENCHMARK_COLLECTOR } from "./compute.js";
import { FEE_COLLECTOR } from "./fees.js";
import { MEASURES, type MeasureValues } from "./measures.js";

type Gap = { companyId: string; status: string; reason?: string };
type SnapshotDiagnostics = { ambiguous: { companyId: string; reason: string }[];
  unmatched: { companyId: string; reason: string }[]; missingFilingDate: string[] };
type Coverage = { value: number; notStated: number; missing: number };

export async function benchmarkReport(db: Db, input: {
  sectorId: string; snapshot?: string; revision?: string; offset?: number; limit?: number;
}) {
  const members = await activeMembers(db, input.sectorId);
  const companyIds = members.map(row => row.id);
  const membership = new Set(companyIds);
  const library = await findEvidenceLibrary(db);
  const files = library ? await db.select().from(sources).where(and(eq(sources.companyId, library.companyId),
    eq(sources.collector, SNAPSHOT_COLLECTOR))) : [];
  const releases = files.map(row => String(row.details?.release ?? "")).filter(month => /^\d{4}-\d{2}$/.test(month)).sort();
  const month = input.snapshot ?? releases.at(-1);
  const snapshotMonth = sql<string>`${facts.qualifiers}->>'snapshot'`;
  const totals = await db.select({ key: facts.key, month: snapshotMonth, n: countDistinct(facts.companyId) })
    .from(facts).where(and(eq(facts.createdBy, SNAPSHOT_COLLECTOR), eq(facts.verification, "verified"), inArray(facts.companyId, companyIds)))
    .groupBy(facts.key, snapshotMonth);
  const byField = new Map(totals.map(row => [`${row.month}:${row.key}`, row.n]));
  const countsFor = (value: number, notStated = 0): Coverage => ({ value, notStated, missing: members.length - value - notStated });
  const coverage = Object.fromEntries(releases.map(release => [release, Object.fromEntries(SNAPSHOT_FIELDS.map(field =>
    [field.key, countsFor(byField.get(`${release}:${field.key}`) ?? 0)]))]));

  const file = files.find(row => row.details?.release === month);
  const diagnostics = (file?.details?.matchReports as Record<string, SnapshotDiagnostics> | undefined)?.[input.sectorId];
  const matches = file ? await db.select({ companyId: sources.companyId, details: sources.details }).from(sources)
    .where(and(eq(sources.collector, SNAPSHOT_COLLECTOR), sql`${sources.details}->>'fileSourceId' = ${file.id}`)) : [];
  const byFirm = new Map<string, string>();
  for (const row of matches) {
    if (!membership.has(row.companyId)) continue;
    const method = row.details?.verification === "verified" ? String(row.details.method) : "unverified";
    if (method !== "unverified" || !byFirm.has(row.companyId)) byFirm.set(row.companyId, method);
  }
  const gapRows = new Map<string, Gap>();
  for (const row of diagnostics?.ambiguous ?? []) if (membership.has(row.companyId)) gapRows.set(row.companyId, { ...row, status: "ambiguous" });
  for (const row of diagnostics?.unmatched ?? []) if (membership.has(row.companyId)) gapRows.set(row.companyId, { ...row, status: "unmatched" });
  for (const companyId of diagnostics?.missingFilingDate ?? []) if (membership.has(companyId)) {
    gapRows.set(companyId, { companyId, status: "missing_filing_date" });
  }
  const matchCounts: Record<string, number> = { crd: 0, sec_number: 0, unverified: 0, unmatched: 0, ambiguous: 0, missing_filing_date: 0, not_imported: 0 };
  for (const { id } of members) {
    const outcome = byFirm.get(id) ?? gapRows.get(id)?.status ?? "not_imported";
    matchCounts[outcome] = (matchCounts[outcome] ?? 0) + 1;
    if (outcome !== "crd" && outcome !== "sec_number") {
      const previous = gapRows.get(id);
      gapRows.set(id, { companyId: id, status: outcome, reason: previous?.status === outcome ? previous.reason : undefined });
    } else gapRows.delete(id);
  }
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 100;
  const exceptions = [...gapRows.values()].sort((a, b) => a.companyId.localeCompare(b.companyId));

  const statusRows = await db.selectDistinctOn([facts.companyId]).from(facts)
    .where(and(eq(facts.createdBy, FEE_COLLECTOR), eq(facts.key, "fee_schedule.status"), inArray(facts.companyId, companyIds)))
    .orderBy(facts.companyId, desc(facts.createdAt), desc(facts.id));
  const feeFacts = await db.select().from(facts).where(and(eq(facts.createdBy, FEE_COLLECTOR),
    eq(facts.key, "firm.fee_schedule"), inArray(facts.companyId, companyIds)));
  const currentFees = new Map(statusRows.filter(row => row.valueText === "available").map(row => [row.companyId, row.qualifiers.input]));
  const terms = ["types", "tier_method", "minimum_annual_fee", "minimum_account_size", "billing_cadence",
    "billing_timing", "value_basis", "negotiable", "household_grouping", "proration", "termination_refund"];
  const feeFields = Object.fromEntries([...terms, "tiers", "at1m", "at5m", "primaryAt1m", "primaryAt5m"].map(field => [field, { value: 0, notStated: 0, missing: members.length }]));
  const reviewFailed = statusRows.filter(row => row.valueText === "review_failed").length;
  const feeClassifications: Record<string, number> = reviewFailed ? { review_failed: reviewFailed } : {};
  for (const row of feeFacts) {
    if (!currentFees.has(row.companyId) || row.qualifiers.input !== currentFees.get(row.companyId)) continue;
    const fee = row.valueJson as { classification?: string; coverage?: { complete: boolean; gaps?: string[] }; schedules?: { tiers: unknown[]; method: string | null; terms: { field: string }[] }[]; terms: Record<string, unknown>; tiers: unknown[]; at1m: unknown; at5m: unknown;
      scenarios?: Partial<Record<"marginal" | "cliff", { at1m: unknown; at5m: unknown }>> };
    const historicalUncertain = fee.classification === "no_price" && fee.coverage?.gaps?.some(gap =>
      ["Unsupported schedule scope", "Unsupported tier rate or boundary", "Unsupported fee rate bounds"].includes(gap));
    const classification = historicalUncertain ? "review_failed" : fee.classification ?? "legacy";
    feeClassifications[classification] = (feeClassifications[classification] ?? 0) + 1;
    for (const field of terms) {
      const coverage = feeFields[field]!;
      if (fee.terms[field] != null || fee.schedules?.some(schedule =>
        field === "tier_method" ? schedule.method !== null : schedule.terms.some(term => term.field === field))) {
        coverage.value++;
        coverage.missing--;
      } else if (fee.coverage?.complete !== false) {
        coverage.notStated++;
        coverage.missing--;
      }
    }
    const hasPrimaryScenario = (field: "at1m" | "at5m") =>
      fee[field] != null || Object.values(fee.scenarios ?? {}).some(scenario => scenario?.[field] != null);
    const measured = {
      tiers: fee.schedules?.some(schedule => schedule.tiers.length > 0) ?? (fee.tiers.length > 0),
      at1m: fee.at1m != null, at5m: fee.at5m != null,
      primaryAt1m: hasPrimaryScenario("at1m"), primaryAt5m: hasPrimaryScenario("at5m"),
    };
    for (const [field, hasValue] of Object.entries(measured)) {
      if (hasValue) {
        feeFields[field]!.value++;
        feeFields[field]!.missing--;
      }
    }
  }
  const scheduleRows = await db.selectDistinctOn([records.companyId], { data: records.data }).from(records)
    .where(and(eq(records.type, "sec_adv_schedules"), inArray(records.companyId, companyIds)))
    .orderBy(records.companyId, desc(records.updatedAt));
  const schedules = Object.fromEntries(["offices_by_state", "websites", "custodian_count", "outside_entity_ownership"].map(key =>
    [key, countsFor(scheduleRows.filter(row => row.data[key] !== undefined && row.data[key] !== null).length)]));
  const ownerCount = await db.select({ n: countDistinct(records.companyId) }).from(records)
    .where(and(eq(records.type, "sec_adv_owner"), inArray(records.companyId, companyIds)));
  schedules["owners"] = countsFor(ownerCount[0]?.n ?? 0);
  const [computation] = library ? await db.select().from(sources).where(and(eq(sources.companyId, library.companyId),
    eq(sources.collector, BENCHMARK_COLLECTOR), sql`${sources.details}->>'sectorId' = ${input.sectorId}`,
    input.revision ? sql`${sources.details}->>'release' = ${input.revision}` : undefined))
    .orderBy(desc(sources.fetchedAt), desc(sources.id)).limit(1) : [];
  const revision = computation?.details?.release;
  const measures = revision ? await db.select({ value: facts.valueJson }).from(facts)
    .where(and(eq(facts.createdBy, BENCHMARK_COLLECTOR), inArray(facts.companyId, companyIds),
      sql`${facts.qualifiers}->>'revision' = ${revision}`)) : [];
  const measuresCoverage = Object.fromEntries(MEASURES.map(key => [key, countsFor(measures.filter(row =>
    (row.value as { values: MeasureValues }).values[key] != null).length)]));
  const websiteRows = await db.selectDistinctOn([records.companyId], { data: records.data }).from(records)
    .where(and(eq(records.type, WEBSITE_SCAN_TYPE), inArray(records.companyId, companyIds)))
    .orderBy(records.companyId, desc(records.updatedAt));
  const categories = ["portal", "custodian", "scheduling", "form", "esign"];
  const websiteStatuses: Record<string, number> = {};
  const clientPageStatuses: Record<string, number> = {};
  const categoryCoverage = new Map<string, number>();
  for (const row of websiteRows) {
    const result = row.data.result as { status: string; clientStatus: string | null; signals: { category: string }[] };
    websiteStatuses[result.status] = (websiteStatuses[result.status] ?? 0) + 1;
    if (result.clientStatus) clientPageStatuses[result.clientStatus] = (clientPageStatuses[result.clientStatus] ?? 0) + 1;
    for (const category of new Set(result.signals.map(signal => signal.category))) {
      categoryCoverage.set(category, (categoryCoverage.get(category) ?? 0) + 1);
    }
  }
  return {
    cohort: members.length, crdCoverage: members.filter(row => !!row.crd).length, snapshot: month ?? null, coverage,
    matchCounts, diagnosticsComplete: diagnostics !== undefined, exceptions: exceptions.slice(offset, offset + limit),
    nextOffset: offset + limit < exceptions.length ? offset + limit : null,
    fees: { available: currentFees.size, unavailable: statusRows.length - currentFees.size, classifications: feeClassifications, fields: feeFields },
    schedules, benchmark: { revision: revision ?? null, measures: measuresCoverage },
    website: { statuses: websiteStatuses, clientPageStatuses, missing: members.length - websiteRows.length,
      fields: Object.fromEntries(categories.map(category => [category, countsFor(categoryCoverage.get(category) ?? 0)])) },
  };
}
