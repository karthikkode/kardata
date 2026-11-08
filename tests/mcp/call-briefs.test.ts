import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { benchmarkFeeJobs, companies, factKeys, facts, harnessSettings, records, researchRuns, sectorCompanies, sectors, sources } from "../../src/db/schema.js";
import { startServer } from "../../src/server.js";
import * as codex from "../../src/harness/codex-extract.js";
import * as readiness from "../../src/harness/codex-status.js";
import * as fetcher from "../../src/collect/fetch.js";
import { CALL_OPENER } from "../../src/domain/call-briefs/brief.js";
import { storeBlob } from "../../src/domain/research/sources.js";
import { verifiedMonthlyRow } from "../../src/domain/call-briefs/evidence.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const handle = getTestDb();
const client = new Client({ name: "call-brief-test", version: "1" });
let server: Awaited<ReturnType<typeof startServer>>;
const outputDirs = new Set<string>();
const sourceFiles = new Set<string>();
beforeAll(async () => {
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: "brief-test" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
    requestInit: { headers: { Authorization: "Bearer brief-test" } },
  }));
});
beforeEach(() => resetTestDb(handle));
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await client.close(); await server.close(); await handle.close();
  for (const dir of outputDirs) await rm(dir, { recursive: true, force: true });
  for (const path of sourceFiles) await rm(path, { force: true });
});
async function data<T = Record<string, unknown>>(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  expect(r.isError, JSON.stringify(r.structuredContent)).toBeUndefined();
  return r.structuredContent as T;
}
async function setup() {
  const sectorId = randomUUID(), ids = [randomUUID(), randomUUID()];
  await handle.db.insert(sectors).values({ id: sectorId, name: `call-brief-test-${sectorId}` });
  await handle.db.insert(companies).values(ids.map((id, i) => ({ id, source: "sec" as const, name: `Synthetic adviser ${i}`,
    website: `https://fixture-${i}.example/`, secCrd: String(910001 + i),
    raw: { "SEC Status Effective Date": "01/01/2020", "Latest ADV Filing Date": "07/01/2026" } })));
  await handle.db.insert(sectorCompanies).values(ids.map(companyId => ({ sectorId, companyId, addedVia: "sec" as const,
    riaDecision: "Accept" as const, riaTier: 0 as const, eligibility: "eligible" as const })));
  const keys = ["firm.accounts", "firm.regulatory_aum", "firm.client_total"];
  await handle.db.insert(factKeys).values(keys.map(key => ({ key, valueType: "number" as const, description: "Synthetic number", status: "provisional" as const, createdBy: "test" }))).onConflictDoNothing();
  for (const companyId of ids) {
    const runId = randomUUID(), sourceId = randomUUID();
    await handle.db.insert(researchRuns).values({ id: runId, companyId, kind: "manual", status: "succeeded" });
    await handle.db.insert(sources).values({ id: sourceId, companyId, runId, url: "https://www.sec.gov/synthetic.csv", finalUrl: "https://www.sec.gov/synthetic.csv", collector: "sec_adv_snapshot", status: "ok" });
    await handle.db.insert(facts).values([
      ...keys.map((key, i) => ({ id: randomUUID(), companyId, key, valueNum: String([250, 50000000, 130][i]), asOf: "2026-07-01", sourceIds: [sourceId],
        qualifiers: { snapshot: "2026-11" }, confidence: "high" as const, verification: "verified" as const, createdBy: "sec_adv_snapshot" })),
      { id: randomUUID(), companyId, key: "firm.accounts", valueNum: "100", asOf: "2025-10-01", sourceIds: [sourceId],
        qualifiers: { snapshot: "2025-12" }, confidence: "high" as const, verification: "verified" as const, createdBy: "sec_adv_snapshot" },
      { id: randomUUID(), companyId, key: "firm.accounts", valueNum: "250", asOf: "2026-07-01", sourceIds: [sourceId],
        confidence: "high" as const, verification: "verified" as const, createdBy: "collector:sec_import" },
      { id: randomUUID(), companyId, key: "firm.accounts", valueNum: "9999999", asOf: "2027-01-01", sourceIds: [sourceId],
        qualifiers: { snapshot: "2027-01" }, confidence: "high" as const, verification: "unverified" as const, createdBy: "untrusted" },
    ]);
  }
  await handle.db.insert(harnessSettings).values([{ key: "ria_extractor_provider", value: { mode: "auto" } },
    { key: "quota_breaker", value: { tripped: true, reason: "reserved" } }]);
  await handle.db.insert(benchmarkFeeJobs).values({ id: "a2050f8b-2fb9-48bf-bf31-b55c7cd86402", sectorId,
    companyIds: ids, status: "paused", cohortSize: 2, eligibleSelected: 2, concurrency: 1 });
  vi.spyOn(readiness, "readCodexSnapshot").mockResolvedValue({ checkedAt: new Date().toISOString(), authenticated: true, modelAvailable: true,
    primary: { usedPercent: 1, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400000).toISOString() }, secondary: null, error: null });
  const fetched = vi.spyOn(fetcher, "fetchUrl").mockImplementation(async (_db, req) => {
    const blocked = new URL(req.url).hostname.includes("adviserinfo.sec.gov");
    const [source] = await handle.db.insert(sources).values({ id: randomUUID(), companyId: req.companyId, runId: req.runId,
      url: req.url, finalUrl: req.url, collector: req.collector, status: blocked ? "blocked" : "ok", httpStatus: blocked ? 403 : 200,
      error: blocked ? "robots.txt unavailable" : null }).returning();
    const html = "<h1>Synthetic adviser</h1><p>We provide financial planning for individual clients and families. Our public services describe the advice we offer.</p><a href='/services'>Services</a><a href='/login'>Login</a>";
    return { source: source!, contentType: "text/html", body: blocked ? undefined : Buffer.from(html), text: blocked ? undefined : html };
  });
  const model = vi.spyOn(codex, "dockerCodexExtractorCall").mockImplementation(async req => {
    const start = req.prompt.indexOf('\n{"callDate"');
    const payload = JSON.parse(req.prompt.slice(start + 1).split("\nRepair")[0]!) as { evidence: { id: string; kind: string }[] };
    const web = payload.evidence.find(e => e.kind === "website")!;
    return { usage: { model: "gpt-6.1-terra", inputTokens: 10, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0, calls: 1 }, json: {
      facts: [{ id: "x1", label: "services", text: "financial planning", evidenceId: web.id, quote: "We provide financial planning" }],
      tasks: [{ text: "checking account lists", factIds: ["size-firm.accounts"] }, { text: "organising plan documents", factIds: ["x1"] }],
      guesses: [{ text: "May need account-list checks", factIds: ["size-firm.accounts"] }],
      questions: ["How did the last account update reach your records?", "How did the last plan's documents reach you?", "Which step took the time?"].map(text => ({ text, factIds: ["size-firm.accounts"] })),
      avoid: [],
    } };
  });
  return { ids, sectorId, model, fetched, args: { sectorId, companyIds: ids, callDate: "2026-11-09" } };
}

it("prepares the first window first, stores dated cited briefs, reads/exports in list order, reruns without model calls, and preserves provider/breaker/fee/facts", async () => {
  const f = await setup();
  const before = { settings: await handle.db.select().from(harnessSettings), jobs: await handle.db.select().from(benchmarkFeeJobs), facts: await handle.db.select().from(facts) };
  const first = await data<{ directory: string; prepared: number; ready: number; items: { path?: string }[] }>("ria_call_briefs_prepare", { ...f.args, limit: 1, concurrency: 1 });
  outputDirs.add(first.directory);
  expect(first).toMatchObject({ prepared: 1, ready: 1 });
  expect(f.model).toHaveBeenCalledTimes(1);
  const content = await readFile(first.items[0]!.path!, "utf8");
  expect(content).toContain(CALL_OPENER);
  expect(content).toContain("+150.0% vs 2025-12 snapshot");
  expect(content).not.toContain("9,999,999");
  expect(content).toContain("owner not found");
  expect(content).toContain("**Guess:** May need account-list checks");
  expect(await data("ria_call_brief_attempts", { companyId: f.ids[0], limit: 1 })).toMatchObject({
    attempts: [{ model: "gpt-6.1-terra", response: { facts: [{ id: "x1", label: "services" }] } }],
  });
  expect(await data("ria_call_briefs_status", f.args)).toMatchObject({ prepared: 1, websitesRead: 1, brochuresFound: 0,
    items: [{ companyId: f.ids[0], status: "ready" }, { companyId: f.ids[1], status: "pending" }] });
  const second = await data<{ directory: string; csvPath: string }>("ria_call_briefs_prepare", { ...f.args, offset: 1, limit: 1 });
  outputDirs.add(second.directory);
  const csv = parse(await readFile(second.csvPath, "utf8"), { columns: true }) as Record<string, string>[];
  expect(csv.map(r => r.company_id)).toEqual(f.ids);
  expect(csv[0]?.opener).toContain("Most solo advisers I talk to lose hours a week on");
  expect(csv[0]?.["top guess"]).toContain("Guess:");
  const callCount = f.model.mock.calls.length;
  expect(await data("ria_call_briefs_prepare", f.args)).toMatchObject({ prepared: 0, reused: 2 });
  expect(f.model).toHaveBeenCalledTimes(callCount);
  expect((await handle.db.select().from(records).where(eq(records.type, "solo_call_brief")))).toHaveLength(2);
  const briefRecord = (await handle.db.select().from(records).where(eq(records.companyId, f.ids[0]!)))[0]!;
  expect(briefRecord.verification).toBe("doc_only");
  const doc = await data<{ contentMd: string }>("document_get", { documentId: briefRecord.data.documentId });
  expect(doc.contentMd ?? JSON.stringify(doc)).toContain("Most solo advisers");
  for (const [, req] of f.fetched.mock.calls) {
    expect(req).toMatchObject({ strictRobots: true, userAgent: "Kardata karthik@kardata.co" });
    expect(req.url).not.toMatch(/linkedin|\/login/);
  }
  expect(f.fetched.mock.calls.filter(([, req]) => req.url.includes("api.adviserinfo")).length).toBe(1);
  expect({ settings: await handle.db.select().from(harnessSettings), jobs: await handle.db.select().from(benchmarkFeeJobs), facts: await handle.db.select().from(facts) }).toEqual(before);
});

it("retains an explicit per-firm reason when grounded generation fails", async () => {
  const f = await setup();
  f.model.mockResolvedValue({ usage: undefined, json: {} });
  const result = await data<{ directory: string; errors: unknown[]; items: { path?: string; status: string }[] }>("ria_call_briefs_prepare", { ...f.args, limit: 1 });
  outputDirs.add(result.directory);
  expect(result.errors).toHaveLength(1);
  expect(result.items[0]?.status).toBe("failed");
  expect(await readFile(result.items[0]!.path!, "utf8")).toContain("Brief not ready");
});

it("stores parallel firms without racing the first record-type registration", async () => {
  const f = await setup();
  const result = await data<{ directory: string; prepared: number; errors: unknown[] }>("ria_call_briefs_prepare", { ...f.args, limit: 2, concurrency: 2 });
  outputDirs.add(result.directory);
  expect(result).toMatchObject({ prepared: 2, errors: [] });
  expect(await handle.db.select().from(records).where(eq(records.type, "solo_call_brief"))).toHaveLength(2);
});

it("reviews a stored attempt without refetching or making another model call and rejects bad evidence/date/company scope", async () => {
  const f = await setup();
  const prepared = await data<{ directory: string }>("ria_call_briefs_prepare", { ...f.args, limit: 1 });
  outputDirs.add(prepared.directory);
  const attempts = await data<{ attempts: { id: number; response: Record<string, unknown>; context: { callDate: string } }[] }>("ria_call_brief_attempts", {
    companyId: f.ids[0], includeContext: true, limit: 1,
  });
  const attempt = attempts.attempts[0]!;
  expect(attempt.context.callDate).toBe(f.args.callDate);
  const calls = f.model.mock.calls.length, fetches = f.fetched.mock.calls.length;
  expect(await data("ria_call_brief_save", { ...f.args, companyId: f.ids[0], attemptId: attempt.id, response: attempt.response })).toMatchObject({ companyId: f.ids[0], ready: 1 });
  expect(f.model).toHaveBeenCalledTimes(calls); expect(f.fetched).toHaveBeenCalledTimes(fetches);
  const wrongCompany = await client.callTool({ name: "ria_call_brief_save", arguments: { ...f.args, companyId: f.ids[1], attemptId: attempt.id, response: attempt.response } });
  expect(wrongCompany.isError).toBe(true);
  const badQuote = { ...attempt.response, facts: [{ id: "bad", label: "services", text: "invented", evidenceId: "absent", quote: "invented quote" }] };
  expect((await client.callTool({ name: "ria_call_brief_save", arguments: { ...f.args, companyId: f.ids[0], attemptId: attempt.id, response: badQuote } })).isError).toBe(true);
  expect((await client.callTool({ name: "ria_call_brief_save", arguments: { ...f.args, callDate: "2026-11-10", companyId: f.ids[0], attemptId: attempt.id, response: attempt.response } })).isError).toBe(true);
});

it("reads stored raw HTML for a public-link check without fetching or exposing binary data", async () => {
  const f = await setup();
  const [source] = await handle.db.select().from(sources).where(eq(sources.companyId, f.ids[0]!));
  const html = '<p>Public portal</p><a href="https://portal.synthetic.example/">Client access</a>';
  const sha = await storeBlob(handle.db, "text/html", Buffer.from(html));
  await handle.db.update(sources).set({ blobSha256: sha }).where(eq(sources.id, source!.id));
  expect(await data("source_get", { sourceId: source!.id, rawText: true })).toMatchObject({ text: html });
  const readable = await data<{ text: string }>("source_get", { sourceId: source!.id });
  expect(readable.text).toContain("Public portal");
  expect(readable.text).not.toContain("href=");
  const binary = await storeBlob(handle.db, "application/pdf", Buffer.from("%PDF-synthetic"));
  await handle.db.update(sources).set({ blobSha256: binary }).where(eq(sources.id, source!.id));
  const rejected = await client.callTool({ name: "source_get", arguments: { sourceId: source!.id, rawText: true } });
  expect(rejected.isError).toBe(true);
  expect(f.fetched).not.toHaveBeenCalled();
  await data("source_fetch", { companyId: f.ids[0], url: "https://fixture-0.example/", strictRobots: true });
  expect(f.fetched).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ strictRobots: true }));
});

it("verifies raw registration dates against the canonical stored SEC file by CRD without trusting legacy unverified facts", async () => {
  const f = await setup();
  await handle.db.update(facts).set({ verification: "unverified" }).where(eq(facts.createdBy, "collector:sec_import"));
  const [child] = await handle.db.select().from(sources).where(eq(sources.companyId, f.ids[0]!));
  const name = `brief-registration-${randomUUID()}.csv`, path = resolve("var/sources/sec", name);
  sourceFiles.add(path); await mkdir(resolve("var/sources/sec"), { recursive: true });
  const csv = 'Organization CRD#,Primary Business Name,SEC Status Effective Date,Latest ADV Filing Date\n910001,Different name is not a match key,06/01/2015,07/01/2026\n999999,Synthetic adviser 0,01/01/2001,07/01/2026\n';
  await writeFile(path, csv);
  const parentId = randomUUID(), url = `https://www.sec.gov/${name}`;
  await handle.db.insert(sources).values({ id: parentId, companyId: f.ids[0]!, runId: child!.runId, url, finalUrl: url,
    collector: "sec_adv_snapshot", status: "ok", details: { digest: createHash("sha256").update(csv).digest("hex") } });
  await handle.db.update(sources).set({ url, finalUrl: url, details: { fileSourceId: parentId } }).where(eq(sources.id, child!.id));
  const result = await data<{ directory: string; items: { path?: string }[] }>("ria_call_briefs_prepare", { ...f.args, limit: 1 });
  outputDirs.add(result.directory);
  const text = await readFile(result.items[0]!.path!, "utf8");
  expect(text).toContain("SEC status since 2015-06-01");
  expect(text).not.toContain("SEC status since 2001-01-01");
  expect(await data("sec_adv_monthly_row", { companyId: f.ids[0], sourceId: child!.id })).toMatchObject({
    crd: "910001", rowNumber: 1, raw: { "SEC Status Effective Date": "06/01/2015" },
  });
  expect((await client.callTool({ name: "sec_adv_monthly_row", arguments: { companyId: f.ids[1], sourceId: child!.id } })).isError).toBe(true);
  const current = (await handle.db.select().from(sources).where(eq(sources.id, child!.id)))[0]!;
  await handle.db.update(sources).set({ details: { digest: "0".repeat(64) } }).where(eq(sources.id, parentId));
  await expect(verifiedMonthlyRow(handle.db, current, "910001")).rejects.toThrow("digest differs");
});
