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
