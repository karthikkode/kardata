import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { benchmarkFeeJobs, documents, evidenceMiningJobs, harnessSettings, researchRuns } from "../../src/db/schema.js";
import { createEvidenceMiningWorker, miningCapacity } from "../../src/domain/research/evidence-mining-jobs.js";
import { startServer } from "../../src/server.js";
import { issueRunToken } from "../../src/runs/tokens.js";
import type { ExtractorCall } from "../../src/runs/extract.js";
import * as extract from "../../src/runs/extract.js";
import * as provider from "../../src/domain/ria-steps/provider.js";
import * as codex from "../../src/harness/codex-extract.js";
import { codexExtractArgs } from "../../src/harness/codex-config.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { miningFixture, miningText, miningThemes } from "../fixtures/evidence-mining.js";
import { storeBlob } from "../../src/domain/research/sources.js";
import { sources } from "../../src/db/schema.js";
import * as pdf from "../../src/lib/sec/pdf-text.js";

const handle = getTestDb(), client = new Client({ name: "evidence-mining-test", version: "1" });
let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: "synthetic-test" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), { requestInit: { headers: { Authorization: "Bearer synthetic-test" } } }));
});
beforeEach(() => resetTestDb(handle)); afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await client.close(); await server.close(); await handle.close(); });
async function tool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args }); expect(r.isError, JSON.stringify(r.structuredContent ?? r.content)).toBeUndefined(); return r.structuredContent as T;
}
type Status = { jobId: string; status: string; reason: string; selected: number; finished: number; pending: number;
  counts: Record<string, number>; results: { documentId: string; recordId: string; outcome: string; item: Record<string, unknown> }[] };
const capacity = async () => ({ weeklyUsedPercent: 60, resetsAt: new Date(Date.now() + 86400000).toISOString() });
const model: ExtractorCall = async request => {
  const input = JSON.parse(request.prompt.split("\n\n").at(-1)!) as { sources: { id: string; text: string }[] };
  expect(input.sources[0]!.text).toContain("UNSTRUCTURED END"); expect(request.prompt).not.toContain("invented document summary");
  expect(codexExtractArgs({ runId: "test", area: "other", inputDir: "/tmp/synthetic" })).toContain('model_reasoning_effort="high"');
  return { json: miningFixture(input.sources[0]!.id), usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0, reasoningTokens: 0, calls: 1 } };
};
async function fixture(count = 2) {
  const library = await tool<{ companyId: string; sectorId: string }>("evidence_library_ensure"); const ids: string[] = [], sourceIds: string[] = [], runIds: string[] = [];
  for (let n = 0; n < count; n++) {
    const s = await tool<{ sourceId: string; runId: string }>("source_capture", { companyId: library.companyId, url: `https://example.com/synthetic-${n}`,
      text: miningText + "\nUNSTRUCTURED END", via: "search" }); sourceIds.push(s.sourceId); runIds.push(s.runId);
    const d = await tool<{ id: string }>("document_save", { companyId: library.companyId, path: `other/synthetic-${n}.md`, content: "invented document summary", sourceIds: [s.sourceId] }); ids.push(d.id);
    await tool("record_upsert", { companyId: library.companyId, records: [{ type: "original_evidence", data: { document_id: d.id, published: "2026-01-01", source_group: "synthetic" }, sourceIds: [s.sourceId], naturalKey: ["document_id"] }] });
  }
  const input = { companyId: library.companyId, documentIds: ids, themes: miningThemes, metadataType: "original_evidence", researchContext: "Operating professional practices, not their software suppliers", concurrency: 2, requestId: randomUUID() };
  return { ...library, ids, sourceIds, runIds, input };
}

it("queues an idempotent job through MCP, mines full sources and leaves paused fee jobs/settings untouched", async () => {
  const f = await fixture();
  const { sector } = await tool<{ sector: { id: string } }>("sector_create", { name: "Synthetic mining safety" });
  const protectedId = randomUUID();
  await handle.db.insert(benchmarkFeeJobs).values({ id: protectedId, sectorId: sector.id, companyIds: [], eligibleSelected: 0, cohortSize: 0, concurrency: 1, status: "paused", reason: "reserved quota" });
  const settings = [{ key: "ria_extractor_provider", value: { mode: "auto" } }, { key: "quota_breaker", value: { tripped: true } }];
  await handle.db.insert(harnessSettings).values(settings);
  const job = await tool<Status>("evidence_mine_run", f.input); expect(job.selected).toBe(2);
  expect((await tool<Status>("evidence_mine_run", f.input)).jobId).toBe(job.jobId);
  const call = vi.fn(model); const worker = createEvidenceMiningWorker(handle.db, { call, capacity }); await worker.tick();
  const status = await tool<Status>("evidence_mine_status", { jobId: job.jobId, includeEvidence: true, limit: 1 });
  expect(status.status).toBe("completed"); expect(status.counts).toEqual({ processed: 2 }); expect(call).toHaveBeenCalledTimes(2);
  const item = status.results[0]!.item; expect(item.published).toBe("2026-01-01");
  expect(item.source_group).toBe("synthetic");
  expect((item.problems as { counts_as_firsthand: boolean }[]).map(p => p.counts_as_firsthand)).toEqual([true, true, false, false]);
  const citations = item.citations as { sourceId: string; quote: string }[];
  const check = await tool<{ checked: number; verified: number }>("evidence_quote_check", { companyId: f.companyId, quotes: citations.map(q => ({ sourceId: q.sourceId, quote: q.quote })) });
  expect(check.verified).toBe(check.checked);
  const [fee] = await handle.db.select().from(benchmarkFeeJobs).where(eq(benchmarkFeeJobs.id, protectedId)); expect(fee!.status).toBe("paused"); expect(fee!.reason).toBe("reserved quota");
  const after = await handle.db.select().from(harnessSettings); for (const s of settings) expect(after.find(r => r.key === s.key)?.value).toEqual(s.value);
  expect(codexExtractArgs({ runId: "test", area: "other", inputDir: "/tmp/synthetic" })).toContain('model_reasoning_effort="medium"');
});

it("uses only the Codex implementation and stops at85% without changing a breaker or resuming on repeat", async () => {
  const f = await fixture(), muse = vi.spyOn(extract, "dockerExtractorCall"), codexCall = vi.spyOn(codex, "dockerCodexExtractorCall");
  const meter = vi.spyOn(provider, "codexSnapshot").mockResolvedValue({ checkedAt: new Date().toISOString(), authenticated: true, modelAvailable: true, error: null,
    primary: { usedPercent: 85, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400000).toISOString() }, secondary: null });
  const job = await tool<Status>("evidence_mine_run", f.input); await createEvidenceMiningWorker(handle.db).tick();
  const paused = await tool<Status>("evidence_mine_status", { jobId: job.jobId });
  expect(paused.status).toBe("paused"); expect(paused.reason).toContain("85%"); expect(paused.finished).toBe(0); expect(paused.pending).toBe(2);
  expect((await tool<Status>("evidence_mine_run", f.input)).status).toBe("paused");
  expect(muse).not.toHaveBeenCalled(); expect(codexCall).not.toHaveBeenCalled();
  const deniedResume = await client.callTool({ name: "evidence_mine_run", arguments: { ...f.input, resume: true } }); expect(deniedResume.isError).toBe(true);
  meter.mockResolvedValue({ checkedAt: new Date().toISOString(), authenticated: true, modelAvailable: true, error: null,
    primary: { usedPercent: 84, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400000).toISOString() }, secondary: null });
  expect((await tool<Status>("evidence_mine_run", { ...f.input, resume: true })).status).toBe("queued");
});

it("fails closed on unknown weekly usage and never clears an existing hold", async () => {
  vi.spyOn(provider, "codexSnapshot").mockResolvedValue({ checkedAt: new Date().toISOString(), authenticated: true, modelAvailable: true, error: null,
    primary: { usedPercent: 1, windowMinutes: 300, resetsAt: new Date(Date.now() + 86400000).toISOString() }, secondary: null });
  await expect(miningCapacity(handle.db)).rejects.toThrow("weekly usage unavailable");
  await handle.db.insert(harnessSettings).values({ key: "ria_codex_hold", value: { kind: "quota", at: "2000-01-01" } });
  await expect(miningCapacity(handle.db)).rejects.toThrow("no hold was cleared");
  const [hold] = await handle.db.select().from(harnessSettings).where(eq(harnessSettings.key, "ria_codex_hold")); expect(hold!.value).toEqual({ kind: "quota", at: "2000-01-01" });
});

it("accepts84% capacity but refuses85%", async () => {
  const spy = vi.spyOn(provider, "codexSnapshot");
  const snapshot = { checkedAt: new Date().toISOString(), authenticated: true, modelAvailable: true, error: null,
    primary: { usedPercent: 84, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400000).toISOString() }, secondary: null };
  spy.mockResolvedValue(snapshot); expect((await miningCapacity(handle.db)).weeklyUsedPercent).toBe(84);
  spy.mockResolvedValue({ ...snapshot, primary: { ...snapshot.primary, usedPercent: 85 } }); await expect(miningCapacity(handle.db)).rejects.toThrow("85%");
});

it("recovers persisted progress after a restart/expired lease and caches unchanged source records", async () => {
  const f = await fixture(); f.input.concurrency = 1;
  const job = await tool<Status>("evidence_mine_run", f.input);
  const first = createEvidenceMiningWorker(handle.db, { call: async input => { const result = await model(input); first.stop(); return result; }, capacity });
  await first.tick(); expect((await tool<Status>("evidence_mine_status", { jobId: job.jobId })).finished).toBe(1);
  await handle.db.update(evidenceMiningJobs).set({ status: "running", leaseId: randomUUID(), leaseUntil: new Date(Date.now() - 10000) }).where(eq(evidenceMiningJobs.id, job.jobId));
  const call = vi.fn(model); await createEvidenceMiningWorker(handle.db, { call, capacity }).tick(); expect(call).toHaveBeenCalledTimes(1);
  expect((await tool<Status>("evidence_mine_status", { jobId: job.jobId })).counts).toEqual({ processed: 2 });
  const second = await tool<Status>("evidence_mine_run", { ...f.input, requestId: randomUUID() }); const noCall = vi.fn();
  await createEvidenceMiningWorker(handle.db, { call: noCall, capacity }).tick(); expect(noCall).not.toHaveBeenCalled();
  expect((await tool<Status>("evidence_mine_status", { jobId: second.jobId })).counts).toEqual({ processed: 2 });
});

it("lists a missing-source exception and never substitutes the document summary", async () => {
  const f = await fixture(1); await handle.db.update(documents).set({ sourceIds: [] }).where(eq(documents.id, f.ids[0]!));
  const job = await tool<Status>("evidence_mine_run", f.input), call = vi.fn();
  await createEvidenceMiningWorker(handle.db, { call, capacity }).tick(); const status = await tool<Status>("evidence_mine_status", { jobId: job.jobId });
  expect(status.counts).toEqual({ exception: 1 }); expect(JSON.stringify(status.results)).toContain("document has no stored source"); expect(call).not.toHaveBeenCalled();
});

it("invalidates a processed cache when an unread source is added", async () => {
  const f = await fixture(1), call = vi.fn(model);
  await tool<Status>("evidence_mine_run", f.input);
  await createEvidenceMiningWorker(handle.db, { call, capacity }).tick();
  const extra = await tool<{ sourceId: string }>("source_capture", { companyId: f.companyId,
    url: "https://example.com/unread-source", text: "Synthetic added material", via: "search" });
  await handle.db.update(sources).set({ blobSha256: null }).where(eq(sources.id, extra.sourceId));
  await handle.db.update(documents).set({ sourceIds: [...f.sourceIds, extra.sourceId] }).where(eq(documents.id, f.ids[0]!));
  const next = await tool<Status>("evidence_mine_run", { ...f.input, requestId: randomUUID() });
  await createEvidenceMiningWorker(handle.db, { call, capacity }).tick();
  expect(call).toHaveBeenCalledTimes(2);
  const status = await tool<Status>("evidence_mine_status", { jobId: next.jobId, includeEvidence: true });
  expect(status.counts).toEqual({ partial: 1 });
  expect(status.results[0]!.item.source_gaps).toEqual([`source ${extra.sourceId} has no stored text`]);
});

it("reads every physical PDF page, preserves page citations and names unread pages", async () => {
  const f = await fixture(1), lateText = "Alex: The implementation saved 40 hours.";
  const digest = await storeBlob(handle.db, "application/pdf", Buffer.from("%PDF-synthetic-mining-test"));
  await handle.db.update(sources).set({ blobSha256: digest }).where(eq(sources.id, f.sourceIds[0]!));
  const pages = vi.spyOn(pdf, "pdfPageText").mockImplementation(async (_body, page) => ({ text: page === 1 ? miningText + "\nUNSTRUCTURED END" : page === 2 ? "" : lateText, pageNumber: page, totalPages: 3 }));
  const call: ExtractorCall = async request => {
    const input = JSON.parse(request.prompt.split("\n\n").at(-1)!) as { sources: { id: string; page: number; text: string }[] };
    expect(input.sources.map(s => s.page)).toEqual([1, 3]);
    const answer = miningFixture(input.sources[0]!.id); answer.citations.push({ id: "late", source_id: input.sources[1]!.id, quote: "The implementation saved 40 hours." });
    answer.problems[0]!.results = [{ metric: "time saved", stated: "40 hours", number: 40, unit: "hours", period: "not stated", context: "at time of problem", evidence: ["late"] }];
    return { json: answer, usage: undefined };
  };
  const job = await tool<Status>("evidence_mine_run", f.input); await createEvidenceMiningWorker(handle.db, { call, capacity }).tick();
  const status = await tool<Status>("evidence_mine_status", { jobId: job.jobId, includeEvidence: true });
  expect(status.counts).toEqual({ partial: 1 }); expect(pages).toHaveBeenCalledTimes(3);
  const item = status.results[0]!.item;
  expect(item.source_gaps).toEqual([`source ${f.sourceIds[0]} physical page 2 has no text`]);
  expect(item.citations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "late", sourceId: f.sourceIds[0], page: 3 })]));
});

it("keeps literal-check failures, foreign ownership and operator-only access explicit", async () => {
  const f = await fixture(1);
  const check = await tool<{ verified: number }>("evidence_quote_check", { companyId: f.companyId,
    quotes: [{ sourceId: f.sourceIds[0], quote: "I own Synthetic Practice." }, { sourceId: f.sourceIds[0], quote: "I  own Synthetic Practice." }] }); expect(check.verified).toBe(1);
  const { sector } = await tool<{ sector: { id: string } }>("sector_create", { name: "Synthetic evidence privacy" });
  const foreign = await tool<{ company: { id: string } }>("company_add", { sectorId: sector.id, name: "Synthetic other company" });
  const denied = await client.callTool({ name: "evidence_quote_check", arguments: { companyId: foreign.company.id, quotes: [{ sourceId: f.sourceIds[0], quote: "I own Synthetic Practice." }] } }); expect(denied.isError).toBe(true);
  await handle.db.update(researchRuns).set({ status: "running" }).where(eq(researchRuns.id, f.runIds[0]!));
  const token = await issueRunToken(handle.db, { runId: f.runIds[0]!, companyId: f.companyId, ttlMinutes: 10 });
  const agent = new Client({ name: "synthetic-run", version: "1" }); await agent.connect(new StreamableHTTPClientTransport(new URL("/mcp", server.url), { requestInit: { headers: { Authorization: `Bearer ${token.token}` } } }));
  try {
    const deniedRun = await agent.callTool({ name: "evidence_mine_run", arguments: f.input }); expect(deniedRun.isError).toBe(true);
    const deniedCheck = await agent.callTool({ name: "evidence_quote_check", arguments: { companyId: f.companyId, quotes: [{ sourceId: f.sourceIds[0], quote: "I own Synthetic Practice." }] } }); expect(deniedCheck.isError).toBe(true);
    const deniedStatus = await agent.callTool({ name: "evidence_mine_status", arguments: { jobId: randomUUID() } }); expect(deniedStatus.isError).toBe(true);
  } finally { await agent.close(); }
});
