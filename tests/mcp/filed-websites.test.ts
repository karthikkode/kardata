import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { companies, facts, records, sources } from "../../src/db/schema.js";
import { startServer } from "../../src/server.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import * as brochures from "../../src/domain/benchmark/brochure-review.js";
import { websiteInputs } from "../../src/domain/benchmark/website-input.js";
import { FILED_WEBSITE_KEY } from "../../src/domain/benchmark/website-address.js";
import { websiteVendorConfig } from "../../src/collect/collectors/website-software.js";
import { sectorData } from "../../src/domain/benchmark/sector-data.js";

const handle = getTestDb(), client = new Client({ name: "filed-website-test", version: "1" });
let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: "test-only" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), { requestInit: { headers: { Authorization: "Bearer test-only" } } }));
});
beforeEach(() => resetTestDb(handle));
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await client.close(); await server.close(); await handle.close(); });
async function tool(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError, JSON.stringify(response.structuredContent)).toBeUndefined();
  return response.structuredContent as Record<string, unknown>;
}
async function fixture(addresses = ["https://corporate.example/about", "https://linkedin.com/synthetic"]) {
  const { sector } = await tool("sector_create", { name: "ria-us" }) as { sector: { id: string } };
  const { company } = await tool("company_add", { sectorId: sector.id, name: "Synthetic filed website" }) as { company: { id: string } };
  await handle.db.update(companies).set({ secCrd: "990001", domain: "linkedin.com" }).where(eq(companies.id, company.id));
  const text = "Synthetic filing cover\nWebsite: www.corporate.example\nAlso contact alternate@example.test";
  const capture = async (url: string, content: string) => (await tool("source_capture", { companyId: company.id, url, text: content,
    via: "browser", passages: [content] })).sourceId as string;
  const filing = await capture("https://www.sec.gov/synthetic-schedules.zip", "Synthetic Schedule D");
  await handle.db.update(sources).set({ collector: "sec_adv_schedules", details: {
    crd: "990001", verification: "verified", filingDate: "2024-08-01", filingId: "fixture-filing",
  } }).where(eq(sources.id, filing));
  await tool("record_upsert", { companyId: company.id, records: [{ type: "sec_adv_schedules", naturalKey: ["filing_id"], sourceIds: [filing],
    data: { filing_id: "fixture-filing", filing_date: "2024-08-01", websites: addresses } }] });
  await handle.db.update(records).set({ createdBy: "sec_adv_schedules" }).where(eq(records.companyId, company.id));
  const brochure = await capture("https://www.sec.gov/synthetic-brochure.pdf", text);
  vi.spyOn(brochures, "loadBrochureEvidence").mockResolvedValue({ complete: true, gaps: [], firmFound: true, sourceIds: [brochure], date: "2026-01-01",
    item5: [], passages: [{ kind: "firm", ref: "cover", text, page: 1, sourceId: brochure, documentId: randomUUID(), date: "2026-01-01" }] });
  return { sectorId: sector.id, companyId: company.id, filing, brochure };
}

it("defaults to no-write, preserves company inputs, dates/cites the separate fact, and reuses it only as fallback", async () => {
  const f = await fixture();
  const before = await handle.db.select().from(companies);
  expect(await tool("sec_adv_website_promote", { sectorId: f.sectorId })).toMatchObject({ dryRun: true, written: 0,
    results: [{ companyId: f.companyId, outcome: "candidate", url: "https://corporate.example/" }] });
  expect(await handle.db.select().from(facts)).toHaveLength(0);
  const input = { sectorId: f.sectorId, dryRun: false };
  const results = await Promise.all([tool("sec_adv_website_promote", input), tool("sec_adv_website_promote", input)]);
  expect(results.reduce((n, row) => n + Number(row.written), 0)).toBe(1);
  expect(await handle.db.select().from(companies)).toEqual(before);
  const saved = await handle.db.select().from(facts).where(eq(facts.key, FILED_WEBSITE_KEY));
  expect(saved).toMatchObject([{ asOf: "2024-08-01", sourceIds: [f.filing, f.brochure],
    valueJson: { filingDate: "2024-08-01", brochureDate: "2026-01-01", brochurePage: 1,
      filedAddresses: ["https://corporate.example/about"] } }]);
  expect(await tool("sec_adv_website_promote", input)).toMatchObject({ written: 0 });
  const config = websiteVendorConfig.parse(await sectorData(handle.db, f.sectorId, "website-vendors.json"));
  expect((await websiteInputs(handle.db, [f.companyId], config)).get(f.companyId)).toMatchObject({ kind: "filed", shared: false });
  await handle.db.update(companies).set({ website: "https://current.example/" }).where(eq(companies.id, f.companyId));
  expect((await websiteInputs(handle.db, [f.companyId], config)).get(f.companyId)?.home?.href).toBe("https://current.example/");
});

it("rejects shared filed hosts claimed outside the selected sector", async () => {
  const f = await fixture();
  await handle.db.insert(companies).values({ id: randomUUID(), source: "manual", name: "Synthetic unrelated record", domain: "www.corporate.example" });
  expect(await tool("sec_adv_website_promote", { sectorId: f.sectorId })).toMatchObject({
    written: 0, results: [{ outcome: "no_unshared_corroborated_host" }] });
});

it("keeps multiple corroborated hosts unresolved and rejects email-only corroboration", async () => {
  const f = await fixture(["https://corporate.example/", "https://second.example/"]);
  const mock = vi.mocked(brochures.loadBrochureEvidence);
  const evidence = await mock(handle.db, f.companyId);
  evidence.passages[0]!.text = "Websites: corporate.example and second.example";
  mock.mockResolvedValue(evidence);
  expect(await tool("sec_adv_website_promote", { sectorId: f.sectorId })).toMatchObject({ results: [{ outcome: "multiple_corroborated_hosts" }] });
  evidence.passages[0]!.text = "Contact info@corporate.example and info@second.example";
  expect(await tool("sec_adv_website_promote", { sectorId: f.sectorId })).toMatchObject({ results: [{ outcome: "no_unshared_corroborated_host" }] });
});

it("does not promote a missing, unverified or mismatched filing identity", async () => {
  const f = await fixture();
  await handle.db.update(sources).set({ details: { verification: "unverified", filingDate: "2024-08-01" } }).where(eq(sources.id, f.filing));
  expect(await tool("sec_adv_website_promote", { sectorId: f.sectorId, dryRun: false })).toMatchObject({ written: 0, results: [{ outcome: "unverified_filing" }] });
});

it("rejects vendor/public-platform addresses even when printed on the brochure cover", async () => {
  const f = await fixture(["https://spotify.com/fixture", "https://schwab.com/fixture"]);
  const mock = vi.mocked(brochures.loadBrochureEvidence), evidence = await mock(handle.db, f.companyId);
  evidence.passages[0]!.text = "Websites: spotify.com and schwab.com";
  expect(await tool("sec_adv_website_promote", { sectorId: f.sectorId, dryRun: false })).toMatchObject({
    written: 0, results: [{ outcome: "no_unshared_corroborated_host" }] });
});

it("retains a newer dated fact and stops using a promoted host after another firm claims it", async () => {
  const f = await fixture();
  await tool("sec_adv_website_promote", { sectorId: f.sectorId, dryRun: false });
  await handle.db.update(facts).set({ asOf: "2025-08-01", qualifiers: { version: "schedule-website-v1", input: "newer" } }).where(eq(facts.key, FILED_WEBSITE_KEY));
  expect(await tool("sec_adv_website_promote", { sectorId: f.sectorId, dryRun: false })).toMatchObject({ written: 0, results: [{ outcome: "unchanged_or_newer" }] });
  await handle.db.insert(companies).values({ id: randomUUID(), source: "manual", name: "Synthetic new claimant", domain: "corporate.example" });
  const config = websiteVendorConfig.parse(await sectorData(handle.db, f.sectorId, "website-vendors.json"));
  expect((await websiteInputs(handle.db, [f.companyId], config)).get(f.companyId)?.home).toBeNull();
});
