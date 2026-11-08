import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { apolloContacts, benchmarkFeeJobs, companies, factKeys, facts, records, sectorCompanies, sources } from "../../src/db/schema.js";
import { createSector } from "../../src/domain/sectors.js";
import { startServer } from "../../src/server.js";
import * as archive from "../../src/lib/sec/archive.js";
import * as fetcher from "../../src/collect/fetch.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

const handle = getTestDb();
const client = new Client({ name: "owner-names-test", version: "1" });
let server: Awaited<ReturnType<typeof startServer>>;
const oldDirs = process.env.KARDATA_IMPORT_DIRS;
const exports: string[] = [];
beforeAll(async () => {
  await ensureMigrated(handle);
  process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: "names-test" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
    requestInit: { headers: { Authorization: "Bearer names-test" } },
  }));
});
beforeEach(() => resetTestDb(handle));
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await client.close(); await server.close(); await handle.close();
  for (const path of exports) await rm(path, { force: true });
  if (oldDirs === undefined) delete process.env.KARDATA_IMPORT_DIRS; else process.env.KARDATA_IMPORT_DIRS = oldDirs;
});
async function data<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
  return result.structuredContent as T;
}
async function setup(rejectedRows = false) {
  await data("evidence_library_ensure");
  const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
  const { sector } = await createSector(handle.db, { name: `Synthetic names ${randomUUID()}`, profile });
  const ids = Array.from({ length: 6 }, () => randomUUID());
  await handle.db.insert(companies).values(ids.map((id, i) => ({ id, name: "Synthetic filing firm", source: "sec" as const, secCrd: String(910001 + i) })));
  await handle.db.insert(sectorCompanies).values(ids.map((companyId, i) => ({ sectorId: sector.id, companyId, addedVia: "sec" as const,
    riaDecision: i === 3 ? "Hold" as const : i === 5 ? "Reject" as const : "Accept" as const,
    riaTier: i === 3 || i === 5 ? null : i === 0 ? 0 as const : i === 1 ? 2 as const : 1 as const,
    eligibility: i === 3 ? "review" as const : i === 5 ? "ineligible" as const : "eligible" as const })));
  const base = ids.map((_, i) => ({ "1E1": String(910001 + i), FilingID: String(i + 10), DateSubmitted: "12/31/2024 01:00:00 PM" }));
  base.push({ "1E1": "910001", FilingID: "9", DateSubmitted: "12/30/2024" });
  base.splice(4, 1); // No archive filing for this CRD; the identical name must not match another firm.
  const person = (id: string, name: string, title: string, kind = "I") => ({ FilingID: id, Schedule: "A", "Full Legal Name": name,
    "Title or Status": title, "DE/FE/I": kind, "Ownership Code": "E", "Control Person": "Y" });
  const owners = [person("9", "FORMER, PERSON", "OWNER"), person("10", "EXAMPLE, JANE, Q", "OWNER"),
    person("11", "EXAMPLE, CHRIS", "FOUNDER"), person("11", "EXAMPLE, ROBIN", "COO"),
    person("12", "Synthetic Holdings LLC", "OWNER", "DE"), person("13", "EXAMPLE, SAM", "MANAGING PARTNER"),
    person("15", "REJECTED, PERSON", "OWNER")];
  owners.push({ ...person("10", "INDIRECT, PERSON", "OWNER"), Schedule: "B" });
  vi.spyOn(archive, "zipMembers").mockResolvedValue(["IA_ADV_Base_A", "IA_Schedule_A_B"].map(table => ({
    name: `${table}_20111105_20241231.csv`, method: 0, size: 1, localOffset: 0,
  })));
  vi.spyOn(archive, "forEachZipCsv").mockImplementation(async (_path, member, visit) => {
    const rows = member.name.startsWith("IA_ADV_Base_A") ? base : owners;
    rows.forEach(visit);
    return { file: member.name, rows: rows.length, accepted: rows.length, tolerant: 0, rejected: rejectedRows ? 1 : 0, rejections: [] };
  });
  return { sectorId: sector.id, ids, args: { sectorId: sector.id, path: resolve("tests/fixtures/sec-adv-history-a.zip"),
    sourceUrl: "https://www.sec.gov/files/synthetic-contacts.zip" } };
}

it("imports and reads contacts over MCP, exports the selected person, reruns without duplicates and preserves confirmed contacts, paused fee list and revision", async () => {
  const f = await setup();
  const companyId = f.ids[0]!;
  const { sourceId } = await data<{ sourceId: string }>("source_capture", { companyId, url: "https://example.test/confirmed",
    via: "browser", text: "Synthetic confirmed contact", passages: ["Synthetic confirmed contact"] });
  await handle.db.insert(records).values({ id: randomUUID(), companyId, type: "leader", naturalKeyHash: "confirmed-fixture",
    data: { name: "JANE Q EXAMPLE", title: "Confirmed President" }, sourceIds: [sourceId], verification: "verified", createdBy: "owner" });
  const { sourceId: duplicateSource } = await data<{ sourceId: string }>("source_capture", { companyId: f.ids[2], url: "https://example.test/leaders",
    via: "browser", text: "Synthetic leader evidence", passages: ["Synthetic leader evidence"] });
  await handle.db.insert(records).values([
    { id: randomUUID(), companyId: f.ids[2]!, type: "leader", naturalKeyHash: "later-leader", createdAt: new Date("2026-02-01"),
      data: { name: "Synthetic Founder", title: "Founder (later stored record)" }, sourceIds: [duplicateSource], verification: "verified" as const, createdBy: "owner" },
    { id: randomUUID(), companyId: f.ids[2]!, type: "leader", naturalKeyHash: "earlier-leader", createdAt: new Date("2026-01-01"),
      data: { name: "Synthetic Founder", title: "Founder (earlier stored record)" }, sourceIds: [duplicateSource], verification: "verified" as const, createdBy: "owner" },
  ]);
  await handle.db.insert(apolloContacts).values({ apolloId: "synthetic-person", companyId, name: "JANE Q EXAMPLE", title: "Confirmed President",
    source: "synthetic paid source", pulledAt: new Date("2026-01-01") });
  await handle.db.insert(benchmarkFeeJobs).values({ id: "a2050f8b-2fb9-48bf-bf31-b55c7cd86402", sectorId: f.sectorId,
    companyIds: f.ids.slice(0, 2), status: "paused", eligibleSelected: 2, cohortSize: 2, concurrency: 1 });
  await handle.db.insert(factKeys).values({ key: "benchmark.synthetic", valueType: "json", description: "Synthetic benchmark", status: "provisional", createdBy: "test" });
  await handle.db.insert(facts).values({ id: randomUUID(), companyId, key: "benchmark.synthetic", valueJson: { unchanged: true },
    qualifiers: { revision: "8598a1e041f2ffbee69f8a42" }, confidence: "high", sourceIds: [sourceId], createdBy: "benchmark_compute" });
  const before = { jobs: await handle.db.select().from(benchmarkFeeJobs), facts: await handle.db.select().from(facts),
    apollo: await handle.db.select().from(apolloContacts), leaders: await handle.db.select().from(records).where(eq(records.type, "leader")) };
  expect(await data("sec_adv_names_import", f.args)).toMatchObject({ firms: 5, withNames: 3, missing: 2, people: 4, written: 0 });
  expect(await handle.db.select().from(records)).toEqual(before.leaders);
  const runs = await Promise.all([data<{ written: number }>("sec_adv_names_import", { ...f.args, dryRun: false }),
    data<{ written: number }>("sec_adv_names_import", { ...f.args, dryRun: false })]);
  expect(runs.reduce((n, r) => n + r.written, 0)).toBe(5);
  const recordCount = (await handle.db.select().from(records)).length;
  const sourceCount = (await handle.db.select().from(sources)).length;
  expect(await data("sec_adv_names_import", { ...f.args, dryRun: false })).toMatchObject({ written: 0, unchanged: 5 });
  expect(await handle.db.select().from(records)).toHaveLength(recordCount);
  expect(await handle.db.select().from(sources)).toHaveLength(sourceCount);
  expect(await data("company_contacts_get", { companyId })).toMatchObject({ contactable: false,
    bestPerson: { name: "JANE Q EXAMPLE", title: "Confirmed President" },
    filingPeople: [{ name: "JANE Q EXAMPLE", title: "OWNER", ownershipRange: "75% or more", controlPerson: true,
      filingId: "10", filingDate: "2024-12-31", source: "SEC Form ADV Schedule A", verification: "unconfirmed_public_filing" }] });
  expect(await data("company_contacts_get", { companyId: f.ids[1] })).toMatchObject({ bestPerson: { name: "ROBIN EXAMPLE", title: "COO" }, filingPeople: expect.any(Array) });
  expect(await data("sec_adv_names_coverage", { sectorId: f.sectorId, limit: 1 })).toMatchObject({ total: 5, items: expect.any(Array), groups: {
    "Tier 0": { firms: 1, withNames: 1, missing: 0, filingYears: { "2024": 1 } },
    "Tier 1": { firms: 2, withNames: 0, missing: 2, reasons: { no_named_individuals_in_schedule_a: 1, no_filing_in_archive: 1 } },
    "Tier 2": { withNames: 1 }, Hold: { withNames: 1 },
  } });
  const exported = await data<{ path: string; rows: number }>("company_sheet_export", { sectorId: f.sectorId });
  exports.push(exported.path); expect(exported.rows).toBe(4);
  const csv = parse(await readFile(exported.path, "utf8"), { columns: true }) as Record<string, string>[];
  expect(csv.find(row => row["Company ID"] === f.ids[1])).toMatchObject({ "Contact name": "ROBIN EXAMPLE", "Contact title": "COO",
    "Contact source": "SEC Form ADV Schedule A", "Contact filing ID": "11", "Contact filing date": "2024-12-31",
    "Contact ownership range": "75% or more", "Contact control person": "Yes", "Contact verification": "unconfirmed_public_filing",
    "Contact uncertainty": expect.stringContaining("out of date") });
  expect(csv.find(row => row["Company ID"] === f.ids[2])?.["Contact title"]).toBe("Founder (earlier stored record)");
  expect(await data("company_contacts_get", { companyId: f.ids[2] })).toMatchObject({
    bestPerson: { name: "Synthetic Founder", title: "Founder (earlier stored record)" },
  });
  expect({ jobs: await handle.db.select().from(benchmarkFeeJobs), facts: await handle.db.select().from(facts),
    apollo: await handle.db.select().from(apolloContacts), leaders: await handle.db.select().from(records).where(eq(records.type, "leader")) }).toEqual(before);
  const [filed] = (await handle.db.select().from(records)).filter(r => r.companyId === companyId && r.type === "sec_schedule_a_person");
  await handle.db.update(records).set({ verification: "verified", data: { ...filed!.data, title: "Operator confirmed title" } }).where(eq(records.id, filed!.id));
  const confirmed = await handle.db.select().from(records).where(eq(records.id, filed!.id));
  await data("sec_adv_names_import", { ...f.args, path: resolve("tests/fixtures/sec-adv-history-b.zip"),
    sourceUrl: "https://www.sec.gov/files/synthetic-contacts-second.zip", dryRun: false });
  expect(await handle.db.select().from(records).where(eq(records.id, filed!.id))).toEqual(confirmed);
});

it("rejects malformed input before any writes", async () => {
  const f = await setup(true);
  const count = (await handle.db.select().from(sources)).length;
  const result = await client.callTool({ name: "sec_adv_names_import", arguments: { ...f.args, dryRun: false } });
  expect(result.isError).toBe(true);
  expect(await handle.db.select().from(records)).toHaveLength(0);
  expect(await handle.db.select().from(sources)).toHaveLength(count);
});

it("records a blocked newer SEC bulk source and unavailable spot checks with the required fetch policy and no bypass", async () => {
  const f = await setup();
  await data("sec_adv_names_import", { ...f.args, dryRun: false });
  const fetch = vi.spyOn(fetcher, "fetchUrl").mockImplementation(async (_db, req) => {
    const blocked = req.url.includes("reports.adviserinfo");
    const [source] = await handle.db.insert(sources).values({ id: randomUUID(), companyId: req.companyId, runId: req.runId,
      url: req.url, finalUrl: req.url, collector: req.collector, status: blocked ? "blocked" : "ok",
      httpStatus: blocked ? 403 : 200, error: blocked ? "robots.txt unavailable" : null }).returning();
    return { source: source!, body: blocked ? undefined : Buffer.from("<html>Public summary shell</html>") };
  });
  expect(await data("sec_adv_names_public_check", { sectorId: f.sectorId, markArchiveGaps: true })).toMatchObject({ available: false, marked: 1, httpStatus: 403 });
  expect(await data("sec_adv_names_coverage", { sectorId: f.sectorId, tier: 1, missingOnly: true })).toMatchObject({ total: 2, groups: {
    "Tier 1": { reasons: { no_filing_in_archive_newer_sec_unavailable: 1, no_named_individuals_in_schedule_a: 1 } },
  } });
  expect(await data("sec_adv_names_public_check", { sectorId: f.sectorId, companyIds: f.ids.slice(0, 2) })).toMatchObject({
    items: expect.arrayContaining([expect.objectContaining({ companyId: f.ids[0], outcome: "unavailable", reportStatus: "blocked" })]),
  });
  expect(fetch).toHaveBeenCalledTimes(5); // one manifest, summary + report per firm; no alternative hosts
  for (const [, req] of fetch.mock.calls) expect(req).toMatchObject({ userAgent: "Kardata karthik@kardata.co", strictRobots: true });
  expect(new Set(fetch.mock.calls.map(([, req]) => new URL(req.url).hostname))).toEqual(new Set(["adviserinfo.sec.gov", "reports.adviserinfo.sec.gov"]));
  expect(await data("sec_adv_names_import", { ...f.args, dryRun: false })).toMatchObject({ written: 0 });
});
