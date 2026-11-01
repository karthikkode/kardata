import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, facts, records, researchRuns, sources, RIA_STEPS } from "../../src/db/schema.js";
import { createSector } from "../../src/domain/sectors.js";
import { importSec } from "../../src/domain/imports.js";
import { deriveCompany } from "../../src/domain/sector-preflight/eligibility.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import { signalsStep } from "../../src/domain/ria-steps/handlers.js";
import { cleanStoredOfficerTitles } from "../../src/domain/ria-steps/officers.js";
import { recordStep } from "../../src/domain/ria-steps/status.js";
import { riaCsv, riaSheetRows } from "../../src/domain/icp/sheet.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;
beforeAll(async () => { handle = getTestDb(); await ensureMigrated(handle); });
beforeEach(async () => { await resetTestDb(handle); });
afterAll(async () => { await handle.close(); });

async function setup() {
  const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
  const { sector } = await createSector(handle.db, { name: "RIA export repair", profile });
  await importSec(handle.db, sector.id, resolve("tests/fixtures/sec-sample.csv"), { importDirs: fixtureImportDirs() });
  const firms = await handle.db.select().from(companies);
  for (const firm of firms) await deriveCompany(handle.db, sector.id, firm.id);
  const firm = firms.find((f) => f.secCrd === "900001");
  const other = firms.find((f) => f.secCrd === "900002");
  if (!firm || !other) throw new Error("missing fixture firm");
  const runId = randomUUID();
  const sourceId = randomUUID();
  await handle.db.insert(researchRuns).values({ id: runId, companyId: firm.id, kind: "manual", status: "succeeded" });
  await handle.db.insert(sources).values({ id: sourceId, companyId: firm.id, runId, url: "https://example.test/filing.pdf", finalUrl: "https://example.test/filing.pdf", collector: "sec_firm", status: "ok" });
  return { sectorId: sector.id, companyId: firm.id, otherId: other.id, runId, sourceId };
}

it("exports custodian lists consistent with signals, without truncation, and flags missing grounded fee summaries", async () => {
  const f = await setup();
  const names = ["First Synthetic Custodian With A Long Legal Company Name", "Second Synthetic Custodian With A Long Legal Company Name", "Third Synthetic Custodian"];
  const written = await addFacts(handle.db, { companyId: f.companyId, runId: f.runId, createdBy: "extractor:ria_ops", facts: [
    { key: "ria.custodians_named", value: names, sourceIds: [f.sourceId] },
  ] });
  expect(written.every((r) => r.ok)).toBe(true);
  for (const step of RIA_STEPS) await recordStep(handle.db, { sectorId: f.sectorId, companyId: f.companyId, step, status: "done" });
  // The retired fees step survives in live history, but is not part of this pipeline.
  await recordStep(handle.db, { sectorId: f.sectorId, companyId: f.companyId, step: "fees" as never, status: "gap", reason: "legacy fee gap" });
  await signalsStep(handle.db, f.sectorId, f.companyId);
  const row = (await riaSheetRows(handle.db, f.sectorId)).find((r) => r.companyId === f.companyId);
  expect(row?.signals.join(" ")).toContain("Multiple custodians");
  expect(row?.custodians).toBe(names.join("; "));
  expect(row?.feeSummary).toBe("");
  expect(row?.researchStatus).toBe("Complete with gaps");
  expect(row?.researchGaps).toBe("Fee summary unavailable: no grounded fee schedule stored after completed operations read");
  if (!row) throw new Error("no row");
  const csv = parse(riaCsv([row]), { columns: true }) as Record<string, string>[];
  expect(csv[0]?.["Research gaps"]).toBe(row.researchGaps);
  expect(csv[0]?.["Custodians"]).toBe(names.join("; "));
  expect(csv[0]?.["Notes"]).toBe("");
  await addFacts(handle.db, { companyId: f.companyId, runId: f.runId, createdBy: "extractor:ria_ops", facts: [
    { key: "firm.fee_schedule", value: "1% annually", sourceIds: [f.sourceId] },
    { key: "firm.custodians", value: [names[0], "Fourth Synthetic Custodian"], sourceIds: [f.sourceId] },
  ] });
  // Legacy deep extracts stored scalar fee schedules in the JSON column.
  await handle.db.update(facts).set({ valueText: null, valueJson: "1% annually" }).where(eq(facts.key, "firm.fee_schedule"));
  const complete = (await riaSheetRows(handle.db, f.sectorId)).find((r) => r.companyId === f.companyId);
  expect(complete?.feeSummary).toBe("1% annually");
  expect(complete?.researchGaps).toBe("");
  expect(complete?.researchStatus).toBe("Complete");
  expect(complete?.custodians.split("; ")).toHaveLength(4);
  await recordStep(handle.db, { sectorId: f.sectorId, companyId: f.companyId, step: "contacts", status: "gap", reason: "team page unavailable" });
  expect((await riaSheetRows(handle.db, f.sectorId)).find((r) => r.companyId === f.companyId)?.researchGaps).toBe("contacts: team page unavailable");
});

it("reports actual step failures and pending reads instead of claiming missing fee research is complete", async () => {
  const f = await setup();
  await signalsStep(handle.db, f.sectorId, f.companyId);
  let row = (await riaSheetRows(handle.db, f.sectorId)).find((r) => r.companyId === f.companyId);
  expect(row?.researchStatus).toBe("Pending");
  expect(row?.researchGaps).toContain("operations read pending");
  await recordStep(handle.db, { sectorId: f.sectorId, companyId: f.companyId, step: "ops_read", status: "failed", reason: "extractor unavailable" });
  row = (await riaSheetRows(handle.db, f.sectorId)).find((r) => r.companyId === f.companyId);
  expect(row?.researchStatus).toBe("Failed");
  expect(row?.researchGaps).toContain("Fee summary unavailable: extractor unavailable");
});

it("cleans only scoped SEC officer titles in place, preserves provenance, and remains idempotent across later upserts", async () => {
  const f = await setup();
  const input = { companyId: f.companyId, runId: f.runId, createdBy: "collector:sec_firm", records: [
    { type: "leader", data: { name: "Synthetic Officer", title: "I CHIEF COMPLIANCE OFFICER", titleSince: "2019-01-01" }, sourceIds: [f.sourceId], quote: "Synthetic Officer — I CHIEF COMPLIANCE OFFICER", quoteSourceId: f.sourceId, tags: ["filing"] },
    { type: "leader", data: { name: "Synthetic Director", title: "DE MANAGING MEMBER" }, sourceIds: [f.sourceId] },
  ] };
  await upsertRecords(handle.db, input);
  await upsertRecords(handle.db, { ...input, createdBy: "owner", records: [{ ...input.records[0]!, data: { name: "Manual Officer", title: "I PRESIDENT" } }] });
  const before = await handle.db.select().from(records).where(eq(records.companyId, f.companyId));
  const scope = { sectorId: f.sectorId, companyIds: [f.companyId, f.companyId, randomUUID()] };
  expect(await cleanStoredOfficerTitles(handle.db, scope)).toMatchObject({ matched: 2, updated: 0, dryRun: true });
  expect(await handle.db.select().from(records).where(eq(records.companyId, f.companyId))).toEqual(before);
  expect(await cleanStoredOfficerTitles(handle.db, { ...scope, companyIds: [f.otherId], dryRun: false })).toMatchObject({ matched: 0, updated: 0 });
  expect(await cleanStoredOfficerTitles(handle.db, { ...scope, dryRun: false })).toMatchObject({ matched: 2, updated: 2 });
  const after = await handle.db.select().from(records).where(eq(records.companyId, f.companyId));
  for (const old of before) {
    const now = after.find((r) => r.id === old.id)!;
    if (old.createdBy === "owner") { expect(now).toEqual(old); continue; }
    expect(now.data["title"]).not.toMatch(/^(I|DE) /);
    expect({ ...now, data: old.data, naturalKeyHash: old.naturalKeyHash, updatedAt: old.updatedAt, tsv: old.tsv }).toEqual(old);
  }
  await upsertRecords(handle.db, { ...input, records: input.records.map((r) => ({ ...r, data: { ...r.data, title: r.data.title.replace(/^(I|DE) /, "") } })) });
  expect(await handle.db.select().from(records).where(eq(records.companyId, f.companyId))).toHaveLength(3);
  expect(await cleanStoredOfficerTitles(handle.db, { ...scope, dryRun: false })).toMatchObject({ matched: 0, updated: 0 });
  // Existing clean duplicates retain both records and their original evidence.
  await upsertRecords(handle.db, input);
  expect(await cleanStoredOfficerTitles(handle.db, { ...scope, dryRun: false })).toMatchObject({ matched: 2, updated: 2 });
  expect(await handle.db.select().from(records).where(eq(records.companyId, f.companyId))).toHaveLength(5);
});


it("keeps equal-priority contact selection stable when title cleanup rewrites rows", async () => {
  const f = await setup();
  await upsertRecords(handle.db, { companyId: f.companyId, runId: f.runId, createdBy: "collector:sec_firm", records: [
    { type: "leader", data: { name: "Earlier Synthetic Officer", title: "I CHIEF OPERATING OFFICER" }, sourceIds: [f.sourceId] },
  ] });
  await handle.db.update(records).set({ createdAt: new Date("2000-01-01") }).where(eq(records.companyId, f.companyId));
  await upsertRecords(handle.db, { companyId: f.companyId, runId: f.runId, createdBy: "extractor:ria_contacts", records: [
    { type: "leader", data: { name: "Later Synthetic Officer", title: "CHIEF OPERATING OFFICER" }, sourceIds: [f.sourceId] },
  ] });
  await signalsStep(handle.db, f.sectorId, f.companyId);
  const before = (await riaSheetRows(handle.db, f.sectorId)).find((r) => r.companyId === f.companyId);
  expect(before?.contactName).toBe("Earlier Synthetic Officer");
  await cleanStoredOfficerTitles(handle.db, { sectorId: f.sectorId, companyIds: [f.companyId], dryRun: false });
  const after = (await riaSheetRows(handle.db, f.sectorId)).find((r) => r.companyId === f.companyId);
  expect(after?.contactName).toBe(before?.contactName);
  expect(after?.contactTitle).toBe("CHIEF OPERATING OFFICER");
});
