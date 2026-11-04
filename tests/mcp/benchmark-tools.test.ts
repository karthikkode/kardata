import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { companies, facts, records, sectorCompanies, sources } from "../../src/db/schema.js";
import { startServer } from "../../src/server.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

const handle = getTestDb();
const token = "benchmark-test";
let server: Awaited<ReturnType<typeof startServer>>;
const client = new Client({ name: "benchmark-test", version: "1" });

beforeAll(async () => {
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: token });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
});

beforeEach(() => resetTestDb(handle));
afterAll(async () => {
  await client.close();
  await server?.close();
  await handle.close();
});

async function call(tool: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name: tool, arguments: args });
}

async function data<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await call(tool, args);
  expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
  return result.structuredContent as T;
}

async function setup() {
  const library = await data<{ sectorId: string; companyId: string }>("evidence_library_ensure");
  const { sector } = await data<{ sector: { id: string } }>("sector_create", { name: "Synthetic benchmark firms" });
  return { library, sectorId: sector.id };
}

it("keeps the evidence library out of prospect operations while allowing evidence writes", async () => {
  const { library, sectorId } = await setup();
  expect(await data("evidence_library_ensure")).toEqual(library);
  const { company } = await data<{ company: { id: string } }>("company_add", { sectorId, name: "Synthetic prospect" });

  // Even a membership erroneously marked eligible must never expose the library.
  await handle.db.update(sectorCompanies).set({ eligibility: "eligible" }).where(eq(sectorCompanies.companyId, library.companyId));
  expect(await data("sector_list")).toMatchObject({ sectors: [{ id: sectorId }] });
  expect(await data("company_list", { sectorId })).toMatchObject({ total: 1, items: [{ id: company.id }] });
  expect(await data("company_list", { sectorId: library.sectorId })).toMatchObject({ total: 0 });
  expect((await call("company_link", { sectorId, companyId: library.companyId })).isError).toBe(true);
  expect((await call("company_sheet_export", { sectorId: library.sectorId, includeAll: true })).isError).toBe(true);
  expect((await call("sector_icp_start", { sectorId: library.sectorId, companyIds: [library.companyId] })).isError).toBe(true);
  expect((await call("company_icp_get", { sectorId, companyId: library.companyId })).isError).toBe(true);
  expect((await call("company_contacts_get", { companyId: library.companyId })).isError).toBe(true);
  expect(await data("document_save", { companyId: library.companyId, path: "other/evidence.md", content: "Synthetic evidence." }))
    .toMatchObject({ outcome: "created" });
});

it("keeps name matches unverified until independently confirmed and is retry safe", async () => {
  const { library, sectorId } = await setup();
  const ids = Object.fromEntries(["Alpha", "Bravo", "Charlie", "Duplicate", "Missing"].map(name => [name, randomUUID()]));
  await handle.db.insert(companies).values(Object.entries(ids).map(([name, id]) => ({
    id, source: "manual" as const, name: `Fixture ${name}`, state: "WA",
    secCrd: name === "Alpha" ? "910001" : null,
    raw: name === "Bravo" ? { "SEC#": "801-91002" } : {},
  })));
  await handle.db.insert(sectorCompanies).values(Object.values(ids).map(companyId => ({ companyId, sectorId, addedVia: "manual" as const })));
  const dirs = process.env.KARDATA_IMPORT_DIRS;
  process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
  const args = { sectorId, path: join(fixtureImportDirs()[0]!, "sec-adv-snapshot.csv"),
    snapshotDate: "2026-09-02", sourceUrl: "https://www.sec.gov/example-snapshot.zip" };
  try {
    expect(await data("sec_adv_snapshot_import", args)).toMatchObject({
      counts: { crd: 1, secNumber: 1, unverified: 1, ambiguous: 1, unmatched: 1 },
      candidates: [{ companyId: ids["Charlie"], secName: "Fixture Charlie" }],
    });
    expect(await handle.db.select().from(sources)).toHaveLength(0);
    const run = { ...args, dryRun: false };
    const results = await Promise.all([data<{ written: number }>("sec_adv_snapshot_import", run),
      data<{ written: number }>("sec_adv_snapshot_import", run)]);
    expect(results.reduce((count, result) => count + result.written, 0)).toBeGreaterThan(0);
    expect(await data("sec_adv_snapshot_import", run)).toMatchObject({ written: 0 });
    const allFacts = await handle.db.select().from(facts);
    expect(allFacts.some(row => row.companyId === ids["Charlie"])).toBe(false);
    const count = allFacts.find(row => row.companyId === ids["Alpha"] && row.key === "firm.client_total");
    expect(count).toMatchObject({ valueNum: "30", asOf: "2026-09-01", qualifiers: { snapshot: "2026-09" } });
    const sourceRows = await handle.db.select().from(sources);
    expect(sourceRows.filter(row => row.companyId === library.companyId)).toHaveLength(1);
    expect(sourceRows.find(row => row.id === count?.sourceIds[0])?.companyId).toBe(ids["Alpha"]);
    expect(await handle.db.select().from(records)).toMatchObject([{ companyId: ids["Charlie"], data: { status: "unverified", crd: "910003" } }]);
    const charlieId = ids["Charlie"]!;
    await handle.db.update(companies).set({ raw: { "SEC#": "801-91003" } }).where(eq(companies.id, charlieId));
    expect(await data("sec_adv_snapshot_import", run)).toMatchObject({ counts: { secNumber: 1, unverified: 0 } });
    const [charlie] = await handle.db.select().from(companies).where(eq(companies.id, charlieId));
    expect(charlie?.secCrd).toBe("910003");
    expect(await handle.db.select().from(facts).where(and(eq(facts.companyId, charlieId), eq(facts.key, "firm.client_total")))).toHaveLength(0);
  } finally {
    if (dirs === undefined) delete process.env.KARDATA_IMPORT_DIRS;
    else process.env.KARDATA_IMPORT_DIRS = dirs;
  }
});

it("imports archived schedules for the latest qualifying filing and reuses its evidence on retry", async () => {
  const { sectorId } = await setup();
  const companyId = randomUUID();
  await handle.db.insert(companies).values({ id: companyId, name: "Synthetic filing firm", source: "sec", secCrd: "910001" });
  await handle.db.insert(sectorCompanies).values({ companyId, sectorId, addedVia: "sec" });
  const dirs = process.env.KARDATA_IMPORT_DIRS;
  process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
  const args = {
    sectorId, part1Path: join(fixtureImportDirs()[0]!, "sec-adv-history-a.zip"),
    part2Path: join(fixtureImportDirs()[0]!, "sec-adv-history-b.zip"),
    part1Url: "https://www.sec.gov/history-a.zip", part2Url: "https://www.sec.gov/history-b.zip",
  };
  try {
    expect(await data("sec_adv_schedules_import", args)).toMatchObject({ matched: 1, missing: 0, written: 0 });
    expect(await handle.db.select().from(sources)).toHaveLength(0);
    expect(await data("sec_adv_schedules_import", { ...args, dryRun: false })).toMatchObject({ written: 1 });
    const companyRecords = await handle.db.select().from(records).where(eq(records.companyId, companyId));
    expect(companyRecords.filter(row => row.type === "sec_adv_owner").map(row => row.data)).toEqual(expect.arrayContaining([
      expect.objectContaining({ filing_id: "11", ownership_reported: false, entity_type: "individual" }),
      expect.objectContaining({ filing_id: "11", ownership_reported: true, entity_type: "domestic_entity" }),
    ]));
    expect(companyRecords.find(row => row.type === "sec_adv_schedules")?.data).toMatchObject({
      filing_id: "11", filing_date: "2024-09-01", custodian_count: 2, outside_entity_ownership: true,
      websites: ["https://fixture.example/"], offices_by_state: { WA: 2, OR: 1 },
      custodians: [
        { name: "Fixture Custodian", sections: ["5.K.(3)", "7.A"], sharePct: 50 },
        { name: "Fixture Affiliate", sections: ["7.A"], sharePct: null },
      ],
    });
    expect(await data("sec_adv_schedules_import", { ...args, dryRun: false })).toMatchObject({ written: 0 });
    expect(await handle.db.select().from(sources)).toHaveLength(4);
  } finally {
    if (dirs === undefined) delete process.env.KARDATA_IMPORT_DIRS;
    else process.env.KARDATA_IMPORT_DIRS = dirs;
  }
});

it("writes sourced fee terms and reports extraction retries without a live provider", async () => {
  const { sectorId } = await setup();
  const { company } = await data<{ company: { id: string } }>("company_add", { sectorId, name: "Synthetic fee firm" });
  const quote = "Our annual investment management fee is 1% of assets.";
  const { sourceId } = await data<{ sourceId: string }>("source_capture", {
    companyId: company.id, text: quote, url: "https://www.sec.gov/fixture", via: "browser", passages: [quote],
  });
  await data("document_save", {
    companyId: company.id, path: "financials/brochure-item-5.md", title: "Part 2A brochure (2026-03-31)",
    content: quote, sourceIds: [sourceId],
  });
  const { createFeeStep } = await import("../../src/domain/benchmark/fees.js");
  const telemetry: Parameters<Parameters<typeof createFeeStep>[1]>[0][] = [];
  let attempts = 0;
  const step = createFeeStep(async () => {
    attempts++;
    if (attempts === 1) throw new Error("temporary fixture failure");
    return { raw: "", usage: { inputTokens: 120, outputTokens: 20, calls: 1, cachedTokens: 0, reasoningTokens: 0 },
      json: { types: null, tier_method: null, minimum_annual_fee: null, minimum_account_size: null,
        billing_cadence: null, billing_timing: null, value_basis: null, negotiable: null, household_grouping: null,
        proration: null, termination_refund: null, tiers: [{ from: 0, to: null, rate_pct: 1, quote }] } };
  }, row => telemetry.push(row));
  expect(await step(handle.db, sectorId, company.id)).toMatchObject({ status: "done" });
  expect(telemetry).toMatchObject([{ attempts: 2, retries: 1, inputTokens: 120, outputTokens: 20, unmeteredAttempts: 1 }]);
  const feeFacts = await handle.db.select().from(facts).where(eq(facts.companyId, company.id));
  expect(feeFacts.find(row => row.key === "firm.fee_schedule")).toMatchObject({
    asOf: "2026-03-31", quote, sourceIds: [sourceId],
    valueJson: { at1m: { dollars: 10_000, rate_pct: 1 }, at5m: { dollars: 50_000, rate_pct: 1 } },
  });
});

it("computes and reports a reproducible benchmark from verified snapshot facts", async () => {
  await data("evidence_library_ensure");
  const { sector } = await data<{ sector: { id: string } }>("sector_create", { name: "ria-us" });
  const sectorId = sector.id;
  const companyId = randomUUID();
  const missing = randomUUID();
  await handle.db.insert(companies).values([
    { id: companyId, source: "sec", name: "Fixture Alpha", secCrd: "910001" },
    { id: missing, source: "sec", name: "Fixture Missing", secCrd: "910006" },
  ]);
  await handle.db.insert(sectorCompanies).values([companyId, missing].map(id => ({ companyId: id, sectorId, addedVia: "sec" as const })));
  const dirs = process.env.KARDATA_IMPORT_DIRS;
  process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
  try {
    await data("sec_adv_snapshot_import", { sectorId, path: join(fixtureImportDirs()[0]!, "sec-adv-snapshot.csv"),
      snapshotDate: "2026-09-02", sourceUrl: "https://www.sec.gov/example-snapshot.zip", dryRun: false });
    const args = { sectorId, formulaVersion: "fixture-v1", snapshots: { current: "2026-09", prior1: "2025-09", prior3: "2023-09" } };
    const { revision } = await data<{ revision: string }>("benchmark_compute", args);
    expect(await data("benchmark_compute", args)).toMatchObject({ written: 0, revision });
    const measures = await handle.db.select().from(facts).where(eq(facts.key, "benchmark.measures"));
    expect(measures).toHaveLength(2);
    expect(measures.find(row => row.companyId === companyId)).toMatchObject({
      qualifiers: { formula: "fixture-v1", revision, snapshot: "2026-09" },
      valueJson: { values: { clients_per_staff: 7.5, accounts_per_staff: 5, aum_growth_3y_pct: null } },
    });
    expect(await data("benchmark_report", { sectorId, revision, limit: 1 })).toMatchObject({
      cohort: 2, matchCounts: { crd: 1, unmatched: 1 }, diagnosticsComplete: true,
      exceptions: [{ companyId: missing, status: "unmatched" }],
      coverage: { "2026-09": { "firm.client_total": { value: 1, missing: 1, notStated: 0 } } },
      benchmark: { revision, measures: { clients_per_staff: { value: 1, missing: 1 } } },
    });
  } finally {
    if (dirs === undefined) delete process.env.KARDATA_IMPORT_DIRS;
    else process.env.KARDATA_IMPORT_DIRS = dirs;
  }
});
