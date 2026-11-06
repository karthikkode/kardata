import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { companies, records, researchRuns, sources } from "../../src/db/schema.js";
import { startServer } from "../../src/server.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import * as collector from "../../src/collect/collectors/website-software.js";
import { websiteCheckKey } from "../../src/domain/benchmark/website-input.js";
import { sectorData } from "../../src/domain/benchmark/sector-data.js";

const handle = getTestDb(), client = new Client({ name: "website-repair-test", version: "1" });
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
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.structuredContent)).toBeUndefined();
  return result.structuredContent as Record<string, unknown>;
}
async function fixture(robots: boolean) {
  const library = await tool("evidence_library_ensure") as { companyId: string };
  const { sector } = await tool("sector_create", { name: "ria-us" }) as { sector: { id: string } };
  const { company } = await tool("company_add", { sectorId: sector.id, name: "Synthetic redirect fixture", website: "https://repair.example/" }) as { company: { id: string } };
  const capture = async (companyId: string, url: string, text: string) =>
    (await tool("source_capture", { companyId, url, text, via: "browser", passages: [text] })).sourceId as string;
  const libraryPage = await capture(library.companyId, "https://repair.example/", "Synthetic old fetch");
  const [page] = await handle.db.select().from(sources).where(eq(sources.id, libraryPage));
  await handle.db.update(sources).set({ status: "error", httpStatus: null,
    error: robots ? "robots.txt unavailable" : "redirect outside the allowed site or path" }).where(eq(sources.id, libraryPage));
  if (robots) await handle.db.insert(sources).values({ id: randomUUID(), companyId: library.companyId, runId: page!.runId,
    collector: "website_software", url: "https://repair.example/robots.txt", finalUrl: "https://repair.example/robots.txt",
    status: "error", error: "redirect outside the allowed site or path" });
  const citation = await capture(company.id, "https://repair.example/", "Synthetic company citation");
  await handle.db.update(sources).set({ status: "error", httpStatus: null, error: robots ? "robots.txt unavailable" : "redirect outside the allowed site or path",
    details: { siteSourceId: libraryPage } }).where(eq(sources.id, citation));
  const config = collector.websiteVendorConfig.parse(await sectorData(handle.db, sector.id, "website-vendors.json"));
  const key = websiteCheckKey(config, { home: new URL("https://repair.example/"), kind: "website", shared: false });
  await tool("record_upsert", { companyId: company.id, records: [{ type: "website_software", naturalKey: ["check_key"], sourceIds: [citation],
    data: { check_key: key, result: { status: robots ? "robots_unavailable" : "blocked_redirect", clientStatus: null, signals: [] } } }] });
  return { sectorId: sector.id, companyId: company.id, libraryPage, citation, capture, libraryId: library.companyId };
}

it.each([true, false])("allows exactly one durable correction of a %s robots/page redirect", async robots => {
  const f = await fixture(robots);
  const fresh = await f.capture(f.libraryId, "https://repair.example/", "Synthetic repaired homepage");
  const [page] = await handle.db.select().from(sources).where(eq(sources.id, fresh));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockResolvedValue({ status: "none_found", clientStatus: null, signals: [], pages: [page!] });
  const input = { sectorId: f.sectorId, companyIds: [f.companyId] };
  await Promise.all([tool("website_software_collect", input), tool("website_software_collect", input)]);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(await tool("website_software_collect", input)).toMatchObject({ results: [{ status: "none_found", cached: true }] });
  const attempts = await handle.db.select().from(records).where(eq(records.type, "website_software_redirect_attempt"));
  expect(attempts).toHaveLength(1);
});

it("does not grant another attempt when the correction still refuses the redirect", async () => {
  const f = await fixture(false);
  const [page] = await handle.db.select().from(sources).where(eq(sources.id, f.libraryPage));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockResolvedValue({ status: "blocked_redirect", clientStatus: null, signals: [], pages: [page!] });
  const input = { sectorId: f.sectorId, companyIds: [f.companyId] };
  await tool("website_software_collect", input);
  await tool("website_software_collect", input);
  expect(scan).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 406, 418, 500, 503])("retains a stored HTTP %s block even alongside a redirect error", async httpStatus => {
  const f = await fixture(true);
  await handle.db.update(sources).set({ httpStatus }).where(eq(sources.id, f.citation));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockRejectedValue(Error("Must not fetch"));
  expect(await tool("website_software_collect", { sectorId: f.sectorId })).toMatchObject({ results: [{ cached: true, status: "robots_unavailable" }] });
  expect(scan).not.toHaveBeenCalled();
});

it("does not retry a stored block after a config-key change or www alias change", async () => {
  const f = await fixture(true);
  await handle.db.update(sources).set({ httpStatus: 403 }).where(eq(sources.id, f.citation));
  const [saved] = await handle.db.select().from(records).where(eq(records.type, "website_software"));
  await handle.db.update(records).set({ data: { ...saved!.data, check_key: "older-map:https://repair.example/" } }).where(eq(records.id, saved!.id));
  await handle.db.update(companies).set({ website: "https://www.repair.example/" }).where(eq(companies.id, f.companyId));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockRejectedValue(Error("Must not fetch"));
  expect(await tool("website_software_collect", { sectorId: f.sectorId })).toMatchObject({ results: [{ cached: true }] });
  expect(scan).not.toHaveBeenCalled();
});

it("does not reset the one-attempt budget when the input moves to the www alias", async () => {
  const f = await fixture(false);
  const [page] = await handle.db.select().from(sources).where(eq(sources.id, f.libraryPage));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockResolvedValue({ status: "blocked_redirect", clientStatus: null, signals: [], pages: [page!] });
  await tool("website_software_collect", { sectorId: f.sectorId });
  await handle.db.update(companies).set({ website: "https://www.repair.example/" }).where(eq(companies.id, f.companyId));
  await tool("website_software_collect", { sectorId: f.sectorId });
  expect(scan).toHaveBeenCalledTimes(1);
});

it("resolves a robots policy cached from another library run without granting another attempt", async () => {
  const f = await fixture(true), runId = randomUUID();
  await handle.db.insert(researchRuns).values({ id: runId, companyId: f.libraryId, kind: "manual", status: "succeeded" });
  await handle.db.update(sources).set({ runId, fetchedAt: new Date() }).where(eq(sources.id, f.libraryPage));
  const [page] = await handle.db.select().from(sources).where(eq(sources.id, f.libraryPage));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockResolvedValue({ status: "blocked_redirect", clientStatus: null, signals: [], pages: [page!] });
  await tool("website_software_collect", { sectorId: f.sectorId });
  await tool("website_software_collect", { sectorId: f.sectorId });
  expect(scan).toHaveBeenCalledTimes(1);
});

it.each([true, false])("retains historical hard blocks=%s without treating an old soft error as the current cause", async hard => {
  const f = await fixture(false);
  const [original] = await handle.db.select().from(sources).where(eq(sources.id, f.libraryPage));
  await handle.db.insert(sources).values({ id: randomUUID(), companyId: f.libraryId, runId: original!.runId,
    collector: "website_software", url: "https://repair.example/", finalUrl: "https://repair.example/", status: "error",
    httpStatus: hard ? 403 : null, error: hard ? null : "fetch failed", fetchedAt: new Date(Date.now() - 86_400_000) });
  const fresh = await f.capture(f.libraryId, "https://repair.example/", "Synthetic new homepage");
  const [page] = await handle.db.select().from(sources).where(eq(sources.id, fresh));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockResolvedValue({ status: "none_found", clientStatus: null, signals: [], pages: [page!] });
  await tool("website_software_collect", { sectorId: f.sectorId });
  expect(scan).toHaveBeenCalledTimes(hard ? 0 : 1);
});

it.each(["timeout after 15000ms", "fetch failed"])("collects an ordinary %s again instead of caching the failure", async error => {
  const f = await fixture(false);
  const [record] = await handle.db.select().from(records).where(eq(records.type, "website_software"));
  await handle.db.update(records).set({ data: { ...record!.data, result: { status: "fetch_error", clientStatus: null, signals: [] } } }).where(eq(records.id, record!.id));
  await handle.db.update(sources).set({ error }).where(eq(sources.id, f.citation));
  await handle.db.update(sources).set({ error, collector: "website_software", details: { scanKey: record!.data.check_key,
    result: { status: "fetch_error", clientStatus: null, signals: [] }, pageIds: [f.libraryPage] } }).where(eq(sources.id, f.libraryPage));
  const fresh = await f.capture(f.libraryId, "https://repair.example/", "Synthetic recovered transient failure");
  const [page] = await handle.db.select().from(sources).where(eq(sources.id, fresh));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockResolvedValue({ status: "none_found", clientStatus: null, signals: [], pages: [page!] });
  expect(await tool("website_software_collect", { sectorId: f.sectorId })).toMatchObject({ results: [{ status: "none_found", cached: false }] });
  expect(scan).toHaveBeenCalledTimes(1);
  expect(await tool("website_software_collect", { sectorId: f.sectorId })).toMatchObject({ results: [{ status: "none_found", cached: true }] });
});

it.each(["fetch failed", "too many redirects (over 5)"])("does not retry a robots request with %s", async error => {
  const f = await fixture(true);
  const [record] = await handle.db.select().from(records).where(eq(records.type, "website_software"));
  await handle.db.update(records).set({ data: { ...record!.data, result: { status: "fetch_error", clientStatus: null, signals: [] } } }).where(eq(records.id, record!.id));
  await handle.db.update(sources).set({ error }).where(eq(sources.url, "https://repair.example/robots.txt"));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockRejectedValue(Error("Robots failure must stay skipped"));
  expect(await tool("website_software_collect", { sectorId: f.sectorId })).toMatchObject({ results: [{ status: "robots_unavailable", cached: true }] });
  expect(scan).not.toHaveBeenCalled();
});

it.each(["blocked", "robots_disallowed"])("keeps a legacy fetch_error backed by %s evidence skipped", async status => {
  const f = await fixture(false);
  const [record] = await handle.db.select().from(records).where(eq(records.type, "website_software"));
  await handle.db.update(records).set({ data: { ...record!.data, result: { status: "fetch_error", clientStatus: null, signals: [] } } }).where(eq(records.id, record!.id));
  await handle.db.update(sources).set({ status: status as "blocked" | "robots_disallowed", httpStatus: status === "blocked" ? 200 : null,
    error: null }).where(eq(sources.id, f.citation));
  const scan = vi.spyOn(collector, "collectWebsiteSoftware").mockRejectedValue(Error("Must not fetch a challenge or excluded page"));
  expect(await tool("website_software_collect", { sectorId: f.sectorId })).toMatchObject({ results: [{ cached: true }] });
  expect(scan).not.toHaveBeenCalled();
});
