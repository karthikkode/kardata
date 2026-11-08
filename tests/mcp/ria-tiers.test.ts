import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { benchmarkFeeJobs, companies, companyIcpChecks, companyVerdicts, factKeys, facts, sectorCompanies, sectors } from "../../src/db/schema.js";
import { importSec } from "../../src/domain/imports.js";
import { createSector } from "../../src/domain/sectors.js";
import { deriveCompany } from "../../src/domain/sector-preflight/eligibility.js";
import { reclassifyRia, riaProtectedState } from "../../src/domain/sector-preflight/ria-classification.js";
import { companyRevenueTruth } from "../../src/domain/tiering.js";
import { riaSheetRows } from "../../src/domain/icp/sheet.js";
import { startServer } from "../../src/server.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

const handle = getTestDb();
const client = new Client({ name: "ria-tiers-test", version: "1" });
let server: Awaited<ReturnType<typeof startServer>>;
const previousDirs = process.env.KARDATA_IMPORT_DIRS;
const path = resolve("tests/fixtures/sec-ria-registration.csv");
const storedPath = resolve("var/sources/sec", `ria-tiers-test-${randomUUID()}.csv`);
const jobId = "a2050f8b-2fb9-48bf-bf31-b55c7cd86402";
const revision = "8598a1e041f2ffbee69f8a42";
beforeAll(async () => {
  await ensureMigrated(handle);
  await mkdir(resolve("var/sources/sec"), { recursive: true });
  await copyFile(path, storedPath);
  process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: "ria-tiers-test" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
    requestInit: { headers: { Authorization: "Bearer ria-tiers-test" } },
  }));
});
beforeEach(() => resetTestDb(handle));
afterAll(async () => {
  await client.close(); await server.close(); await handle.close();
  await rm(storedPath, { force: true });
  if (previousDirs === undefined) delete process.env.KARDATA_IMPORT_DIRS;
  else process.env.KARDATA_IMPORT_DIRS = previousDirs;
});
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
  return result.structuredContent as Record<string, unknown>;
}
async function setup() {
  const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
  const { sector } = await createSector(handle.db, { name: "Synthetic RIA classification", profile });
  await importSec(handle.db, sector.id, path, { importDirs: fixtureImportDirs() });
  const firms = await handle.db.select().from(companies);
  const accepted = firms.find(f => f.secCrd === "900001")!;
  const hold = firms.find(f => f.secCrd === "900002")!;
  await handle.db.update(facts).set({ valueNum: "0.4" }).where(and(eq(facts.companyId, hold.id), eq(facts.key, "firm.wealth_share")));
  const missing = randomUUID();
  await handle.db.insert(companies).values({ id: missing, source: "manual", name: "Synthetic missing firm", secCrd: "999999", country: "United States", employees: 1 });
  await handle.db.insert(sectorCompanies).values({ sectorId: sector.id, companyId: missing, addedVia: "manual" });
  await handle.db.insert(benchmarkFeeJobs).values({ id: jobId, sectorId: sector.id, status: "paused", reason: "quota",
    companyIds: [accepted.id], eligibleSelected: 1, cohortSize: 1, concurrency: 1 });
  await handle.db.insert(factKeys).values({ key: "benchmark.synthetic", valueType: "json", description: "Synthetic preservation test", status: "provisional", createdBy: "test" });
  const [source] = await handle.db.select({ ids: facts.sourceIds }).from(facts).where(eq(facts.companyId, accepted.id));
  await handle.db.insert(facts).values(["benchmark_compute", "benchmark_fee_schedule", "benchmark_fee_comparable_review"].map(createdBy => ({
    id: randomUUID(), companyId: accepted.id, key: "benchmark.synthetic", valueJson: { unchanged: true },
    sourceIds: source!.ids, confidence: "high" as const, createdBy, qualifiers: { revision },
  })));
  await handle.db.insert(companyIcpChecks).values({ id: randomUUID(), sectorId: sector.id, companyId: accepted.id,
    promptVersion: "ria-light-v2", packHash: "old", score: 1, status: "icp_accepted", results: { signals: [
      { key: "heavy_book", counted: false, verdict: "no", observation: "", refs: [] },
      { key: "recent_deal", counted: true, verdict: "yes", observation: "Synthetic dated deal", refs: ["synthetic-ref"] },
    ] } });
  await handle.db.insert(companyVerdicts).values({ sectorId: sector.id, companyId: accepted.id, score: 1, status: "icp_accepted" });
  await handle.db.insert(companyIcpChecks).values({ id: randomUUID(), sectorId: sector.id, companyId: hold.id,
    promptVersion: "ria-light-v2", packHash: "old-hold", score: 0, status: "icp_rejected", exclusionReason: "not_wealth", results: { signals: [] } });
  return { sectorId: sector.id, accepted: accepted.id, hold: hold.id, missing };
}

it("stores and lists decisions, tiers and reasons over MCP, separately counts Hold, and preserves the paused job and saved revision", async () => {
  const f = await setup();
  const protectedBefore = await riaProtectedState(handle.db, f.sectorId);
  const beforeFacts = await handle.db.select().from(facts);
  const beforeJob = await handle.db.select().from(benchmarkFeeJobs);
  expect(protectedBefore.benchmarkRevisions).toContainEqual({ revision, count: 1 });
  const dry = await call("ria_reclassify", { sectorId: f.sectorId, path });
  expect(dry).toMatchObject({ dryRun: true, canApply: true, total: 5, byDecision: { Accept: 2, Hold: 1, Reject: 2 } });
  expect((await handle.db.select().from(sectorCompanies)).every(m => m.riaDecision === null)).toBe(true);
  const applied = await call("ria_reclassify", { sectorId: f.sectorId, path, dryRun: false });
  expect(applied).toMatchObject({ dryRun: false, checksRefreshed: 2, protectedState: protectedBefore });
  expect(await call("ria_classifications", { sectorId: f.sectorId, decision: "Hold", reason: "hold_not_wealth" }))
    .toMatchObject({ total: 1, byDecision: { Accept: 0, Hold: 1, Reject: 0 }, rows: [{ companyId: f.hold, decision: "Hold", tier: null, reason: "hold_not_wealth" }] });
  expect(await call("ria_classifications", { sectorId: f.sectorId, decision: "Reject" }))
    .toMatchObject({ total: 2, byReason: { not_active: 1, large: 1 } });
  expect(await call("ria_classifications", { sectorId: f.sectorId, tier: 1 }))
    .toMatchObject({ total: 1, rows: [{ companyId: f.accepted, decision: "Accept", tier: 1, reason: "tier:1" }] });
  expect(await call("ria_classifications", { sectorId: f.sectorId, tier: 0 })).toMatchObject({ total: 1, rows: [{ decision: "Accept", tier: 0, reason: "tier:0" }] });
  expect((await riaSheetRows(handle.db, f.sectorId))[0]).toMatchObject({ decision: "Accept", tier: "0" });
  expect(await call("ria_classifications", { sectorId: f.sectorId, limit: 1 }))
    .toMatchObject({ total: 5, nextOffset: 1 });
  expect(await call("sector_preflight_companies", { sectorId: f.sectorId, eligibility: ["review"] }))
    .toMatchObject({ total: 1, rows: [{ decision: "Hold", eligibilityReason: "hold_not_wealth" }] });
  const refused = await client.callTool({ name: "ria_step_run", arguments: { sectorId: f.sectorId, step: "signals", companyIds: [f.hold] } });
  expect(refused.isError).toBe(true);
  expect(await call("sector_scope_apply", { sectorId: f.sectorId })).toMatchObject({ eligible: 2, hold: 1, ineligible: 2 });
  expect(await call("ria_status", { sectorId: f.sectorId })).toMatchObject({ preflight: { eligible: 2, hold: 1, ineligible: 2, pending: 0 } });
  expect(await call("company_icp_get", { companyId: f.hold, sectorId: f.sectorId })).toMatchObject({
    decision: "Hold", status: "icp_watchlist", check: { status: "icp_watchlist", exclusionReason: "hold_not_wealth" },
  });
  const checks = await handle.db.select().from(companyIcpChecks).where(eq(companyIcpChecks.companyId, f.accepted));
  expect(checks).toHaveLength(2);
  expect(checks.find(c => c.promptVersion === "ria-light-v2")?.score).toBe(1);
  expect(checks.find(c => c.promptVersion === "ria-tiers-v2")).toMatchObject({ score: 2, results: { signals: [
    { key: "heavy_book", counted: true, observation: "12 accounts per employee (top quartile of Tier 1)" },
    { key: "recent_deal", counted: true, refs: ["synthetic-ref"] },
  ] } });
  expect(await companyRevenueTruth(handle.db, f.hold, f.sectorId)).toMatchObject({ decision: "Hold", tier: null, status: "icp_watchlist" });
  expect(await deriveCompany(handle.db, f.sectorId, f.missing)).toMatchObject({ decision: "Reject", reason: "not_active" });
  expect((await riaSheetRows(handle.db, f.sectorId)).map(row => row.companyId)).not.toContain(f.hold);
  expect(await handle.db.select().from(facts)).toEqual(beforeFacts);
  expect(await handle.db.select().from(benchmarkFeeJobs)).toEqual(beforeJob);
  expect(await riaProtectedState(handle.db, f.sectorId)).toEqual(protectedBefore);
  const [stored] = await handle.db.select().from(sectors).where(eq(sectors.id, f.sectorId));
  expect(stored!.profile!.ria).toMatchObject({ minEmployees: 1, tier2MinEmployees: 10 });
  expect(stored!.profile!.ria).not.toHaveProperty("groupSplitAum");
});

it("refuses atomically when a paused fee job firm is inactive in the newest file", async () => {
  const f = await setup();
  const before = await riaProtectedState(handle.db, f.sectorId);
  expect(await call("ria_reclassify", { sectorId: f.sectorId, path: resolve("tests/fixtures/sec-ria-inactive.csv") }))
    .toMatchObject({ dryRun: true, canApply: false, total: 5, protectedFailures: [{
      jobId, companyId: f.accepted, decision: "Reject", reason: "not_active", registration: { present: true, status: "Terminated" },
    }] });
  expect(await riaProtectedState(handle.db, f.sectorId)).toEqual(before);
  await expect(reclassifyRia(handle.db, { sectorId: f.sectorId, path: resolve("tests/fixtures/sec-ria-inactive.csv"), dryRun: false }))
    .rejects.toThrow("paused fee job firms would cease to be accepted");
  expect(await riaProtectedState(handle.db, f.sectorId)).toEqual(before);
  expect((await handle.db.select().from(sectorCompanies)).every(m => m.riaDecision === null)).toBe(true);
});

it("allows the server-owned SEC archive without widening operator import directories", async () => {
  const f = await setup();
  process.env.KARDATA_IMPORT_DIRS = "";
  try {
    expect(await call("ria_reclassify", { sectorId: f.sectorId, path: storedPath }))
      .toMatchObject({ dryRun: true, total: 5, byDecision: { Accept: 2, Hold: 1, Reject: 2 } });
  } finally {
    process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
  }
});

it("applies only explicitly reviewed SEC omissions while preserving the paused fee list and benchmark revision", async () => {
  const f = await setup();
  const missingPath = resolve("tests/fixtures/sec-ria-missing.csv");
  const before = await riaProtectedState(handle.db, f.sectorId);
  const preview = await call("ria_reclassify", { sectorId: f.sectorId, path: missingPath });
  expect(preview).toMatchObject({ canApply: false, protectedFailures: [{ companyId: f.accepted, reason: "not_active", registration: { present: false } }] });
  const invalid = await client.callTool({ name: "ria_reclassify", arguments: { sectorId: f.sectorId, path: missingPath,
    dryRun: false, acknowledgeNotActiveCompanyIds: [f.hold] } });
  expect(invalid.isError).toBe(true);
  expect(await riaProtectedState(handle.db, f.sectorId)).toEqual(before);
  expect(await call("ria_reclassify", { sectorId: f.sectorId, path: missingPath, dryRun: false,
    acknowledgeNotActiveCompanyIds: [f.accepted] })).toMatchObject({
      canApply: true, byDecision: { Accept: 1, Hold: 1, Reject: 3 }, unacknowledgedFailures: [],
      acknowledgeNotActiveCompanyIds: [f.accepted], protectedState: before,
    });
  expect(await call("ria_classifications", { sectorId: f.sectorId, companyIds: [f.accepted] }))
    .toMatchObject({ total: 1, rows: [{ companyId: f.accepted, decision: "Reject", tier: null, reason: "not_active" }] });
  expect(await riaProtectedState(handle.db, f.sectorId)).toEqual(before);
});
