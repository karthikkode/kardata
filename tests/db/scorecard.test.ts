import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, facts, records, researchRuns, sources, webSearches } from "../../src/db/schema.js";
import { recordEvent } from "../../src/collect/db.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { addFinding } from "../../src/domain/research/findings.js";
import { setAreaStatus } from "../../src/domain/research/status.js";
import { reviewsIngest } from "../../src/domain/research/reviews.js";
import { isPrimarySource, scorecard } from "../../src/domain/research/scorecard.js";
import { DomainError } from "../../src/domain/errors.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

beforeEach(async () => {
  await resetTestDb(handle);
});

afterAll(async () => {
  await handle.close();
});

async function makeCompany(domain = "example.com"): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name: "Score Co", domain })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeAgentRun(companyId: string, batchId: string): Promise<string> {
  const started = new Date(Date.now() - 30 * 60 * 1000);
  const [row] = await handle.db
    .insert(researchRuns)
    .values({
      id: randomUUID(),
      companyId,
      kind: "agent",
      status: "succeeded",
      batchId,
      promptVersion: "v1",
      startedAt: started,
      finishedAt: new Date(started.getTime() + 20 * 60 * 1000),
      agentUsage: {
        model: "m",
        inputTokens: 1000,
        outputTokens: 100,
        cachedTokens: 500,
        reasoningTokens: 10,
        calls: 3,
        childrenIncluded: true,
      },
    })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("no run row");
  return row.id;
}

async function makeSource(companyId: string, runId: string, url: string): Promise<string> {
  const [row] = await handle.db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId,
      runId,
      url,
      finalUrl: url,
      collector: "test",
      status: "ok",
      httpStatus: 200,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("no source row");
  return row.id;
}

describe("isPrimarySource", () => {
  it("matches the company domain, subdomains and official APIs", () => {
    expect(isPrimarySource("https://example.com/about", "example.com")).toBe(true);
    expect(isPrimarySource("https://shop.example.com/", "example.com")).toBe(true);
    expect(isPrimarySource("https://www.example.com/", "example.com")).toBe(true);
    expect(isPrimarySource("https://www.sec.gov/cgi-bin/browse-edgar", "example.com")).toBe(true);
    expect(
      isPrimarySource("https://find-and-update.company-information.service.gov.uk/x", "example.com"),
    ).toBe(true);
    expect(isPrimarySource("https://thirdparty.example/", "example.com")).toBe(false);
    expect(isPrimarySource("https://example.com.evil.example/", "example.com")).toBe(false);
    expect(isPrimarySource("apollo:import/1/2", "example.com")).toBe(false);
    expect(isPrimarySource("https://example.com/", null)).toBe(false);
  });
});

describe("scorecard", () => {
  it("counts one run across tables, areas and events", async () => {
    const companyId = await makeCompany();
    const batchId = randomUUID();
    const runId = await makeAgentRun(companyId, batchId);
    const by = `agent:${runId}/product`;
    const own = await makeSource(companyId, runId, "https://example.com/catalog");
    const third = await makeSource(companyId, runId, "https://press.example/story");

    const factResults = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: by,
      facts: [
        { key: "product.count", value: 42, sourceIds: [own] },
        { key: "test.drifted_name", value: "x", sourceIds: [third] },
      ],
    });
    expect(factResults.every((r) => r.ok)).toBe(true);

    const recordResults = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: by,
      records: [
        {
          type: "product",
          data: { name: "Cream", url: "https://example.com/cream" },
          sourceIds: [own],
        },
        {
          type: "test_drifted_type",
          data: { name: "Odd" },
          sourceIds: [third],
        },
      ],
    });
    expect(recordResults.every((r) => r.ok)).toBe(true);

    const ingested = await reviewsIngest(handle.db, {
      companyId,
      runId,
      sourceId: own,
      platform: "onsite",
      createdBy: `agent:${runId}/reviews`,
      reviews: [
        { rating: 5, text: "great cream", date: "2026-01-01" },
        { rating: 1, text: "broke me out", date: "2026-01-02" },
      ],
    });
    expect(ingested.results.filter((r) => r.ok)).toHaveLength(2);

    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "product/catalog.md",
      title: "Catalog",
      contentMd: "forty-two products",
      sourceIds: [own],
      createdBy: by,
    });
    // Collect-phase output shares the run id but must not count as agent work.
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      facts: [{ key: "product.count", value: 1, sourceIds: [own] }],
    });
    await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      records: [
        {
          type: "product",
          data: { name: "Collector item", url: "https://example.com/collector-item" },
          sourceIds: [own],
        },
      ],
    });
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "meta/run-summary.md",
      title: "Run summary",
      contentMd: "collect done",
      createdBy: "run",
    });
    const factId = factResults[0] && factResults[0].ok ? factResults[0].id : null;
    await addFinding(handle.db, {
      companyId,
      runId,
      area: "product",
      claim: "big catalog",
      sourceIds: [own],
      factIds: factId ? [factId] : [],
      confidence: "high",
      status: "supported",
      createdBy: by,
    });
    await addFinding(handle.db, {
      companyId,
      runId,
      area: "marketing",
      claim: "lonely claim",
      sourceIds: [third],
      confidence: "low",
      status: "unverified",
      createdBy: `agent:${runId}/main`,
    });
    await setAreaStatus(handle.db, { runId, area: "product", status: "done" });
    await setAreaStatus(handle.db, { runId, area: "marketing", status: "not_found", reason: "nothing" });
    await recordEvent(handle.db, runId, "mcp_call", { tool: "fact_add", status: "ok" });
    await recordEvent(handle.db, runId, "mcp_call", { tool: "sector_create", status: "forbidden" });

    const result = await scorecard(db(), { batchId });
    expect(result.runs).toHaveLength(1);
    const run = result.runs[0] as NonNullable<(typeof result.runs)[number]>;
    expect(run.companyName).toBe("Score Co");
    expect(run.status).toBe("succeeded");
    expect(run.promptVersion).toBe("v1");
    expect(run.minutes).toBe(20);
    expect(run.tokens).toMatchObject({ input: 1000, output: 100, calls: 3, childrenIncluded: true });
    expect(run.mcpCalls).toBe(2);
    expect(run.forbidden).toBe(1);
    // 2 explicit + 1 collector fact plus the ingest's recomputed review facts (all own-cited).
    const recomputed = ingested.recomputed.length;
    expect(recomputed).toBeGreaterThan(0);
    expect(run.facts).toBe(3 + recomputed);
    expect(run.primaryShare).toBe(Math.round(((2 + recomputed) / (3 + recomputed)) * 100) / 100);
    expect(run.agent).toMatchObject({
      facts: 2 + recomputed,
      reviewsIngested: 2,
      documents: 1,
      findings: 2,
    });
    expect(run.agent.recordsByType).toEqual({ product: 1, test_drifted_type: 1, review: 2 });
    expect(run.recordsByType).toEqual({ product: 2, test_drifted_type: 1, review: 2 });
    expect(run.reviewsIngested).toBe(2);
    expect(run.documents).toBe(2);
    expect(run.findings).toBe(2);
    expect(run.findingsWellCited).toBe(1);
    expect(run.newProvisionalKeys).toContain("test.drifted_name");
    for (const key of run.newProvisionalKeys) {
      expect(key === "test.drifted_name" || key.startsWith("reviews.")).toBe(true);
    }
    expect(run.newProvisionalTypes).toEqual(["test_drifted_type"]);
    expect(run.areas["product"]).toMatchObject({ facts: 2, documents: 1, findings: 1, status: "done" });
    expect(run.areas["reviews"]?.facts).toBe(recomputed);
    expect(run.areas["product"]?.recordsByType).toEqual({ product: 2 });
    expect(run.areas["reviews"]?.reviewsIngested).toBe(2);
    expect(run.areas["marketing"]).toMatchObject({ findings: 1, status: "not_found" });
    expect(result.totals).toMatchObject({
      runs: 1,
      facts: 3 + recomputed,
      reviewsIngested: 2,
      documents: 2,
      findings: 2,
      mcpCalls: 2,
      forbidden: 1,
      minutes: 20,
      runsWithUsage: 1,
    });
    expect(result.totals.tokens).toMatchObject({ input: 1000, output: 100, calls: 3 });
    expect(result.totals.childrenIncluded).toBe(true);
  });

  it("reports grounding verification shares over agent and extractor rows", async () => {
    const companyId = await makeCompany();
    const batchId = randomUUID();
    const runId = await makeAgentRun(companyId, batchId);
    const by = `agent:${runId}/product`;
    const own = await makeSource(companyId, runId, "https://example.com/catalog");
    const factResults = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: by,
      facts: [
        { key: "product.count", value: 42, sourceIds: [own] },
        { key: "product.color", value: "red", sourceIds: [own] },
        { key: "product.size", value: "big", sourceIds: [own] },
      ],
    });
    expect(factResults.every((r) => r.ok)).toBe(true);
    const recordResults = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: `extractor:${runId}/product`,
      records: [{ type: "product", data: { name: "Cream", url: "https://example.com/cream" }, sourceIds: [own] }],
    });
    expect(recordResults.every((r) => r.ok)).toBe(true);
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      facts: [{ key: "product.count", value: 1, sourceIds: [own] }],
    });
    const factId = factResults[0]?.ok ? factResults[0].id : "";
    const mismatchId = factResults[2]?.ok ? factResults[2].id : "";
    const recordId = recordResults[0]?.ok ? recordResults[0].id : "";
    await handle.db.update(facts).set({ verification: "verified" }).where(eq(facts.id, factId));
    await handle.db.update(facts).set({ verification: "quote_mismatch" }).where(eq(facts.id, mismatchId));
    await handle.db.update(records).set({ verification: "doc_only" }).where(eq(records.id, recordId));

    const result = await scorecard(db(), { batchId });
    expect(result.runs[0]?.verification).toEqual({ verified: 1, verifiedValue: 0, docOnly: 1, mismatch: 1, unverified: 1 });
    expect(result.totals.verification).toEqual({ verified: 1, verifiedValue: 0, docOnly: 1, mismatch: 1, unverified: 1 });
    expect(result.runs[0]?.verificationByKind).toEqual({
      number: { verified: 1, verifiedValue: 0, docOnly: 0, mismatch: 0, unverified: 0 },
      short_text: { verified: 0, verifiedValue: 0, docOnly: 0, mismatch: 1, unverified: 1 },
    });
    expect(result.runs[0]?.verificationByRecordType).toEqual({
      product: { verified: 0, verifiedValue: 0, docOnly: 1, mismatch: 0, unverified: 0 },
    });
    expect(result.totals.verificationByKind).toEqual(result.runs[0]?.verificationByKind);
    expect(result.totals.verificationByRecordType).toEqual(result.runs[0]?.verificationByRecordType);
  });

  it("reports verification by evidence grade and web search stats", async () => {
    const companyId = await makeCompany();
    const batchId = randomUUID();
    const runId = await makeAgentRun(companyId, batchId);
    const by = `agent:${runId}/product`;
    const primary = await makeSource(companyId, runId, "https://example.com/catalog");
    const secondary = await makeSource(companyId, runId, "https://example.invalid/hit");
    await handle.db.update(sources).set({ via: "search", evidenceGrade: "secondary" }).where(eq(sources.id, secondary));
    const factResults = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: by,
      facts: [
        { key: "product.count", value: 42, sourceIds: [primary] },
        { key: "product.color", value: "red", sourceIds: [secondary] },
      ],
    });
    expect(factResults.every((r) => r.ok)).toBe(true);
    const first = factResults[0]?.ok ? factResults[0].id : "";
    const second = factResults[1]?.ok ? factResults[1].id : "";
    await handle.db.update(facts).set({ verification: "verified_value" }).where(eq(facts.id, first));
    await handle.db.update(facts).set({ verification: "verified" }).where(eq(facts.id, second));
    const [searchLinked] = await handle.db
      .insert(webSearches)
      .values({
        id: randomUUID(), runId, companyId, area: "product", tool: "web_search",
        queryOrUrl: "Acme cream", results: [{ url: "https://example.invalid/hit", title: "H", snippet: "s", rank: 0 }], resultCount: 1,
      })
      .returning({ id: webSearches.id });
    await handle.db
      .insert(webSearches)
      .values({
        id: randomUUID(), runId, companyId, area: null, tool: "web_fetch",
        queryOrUrl: "https://example.invalid/other", results: [], resultCount: 0,
      });
    await handle.db.update(sources).set({ webSearchId: searchLinked?.id ?? null }).where(eq(sources.id, secondary));
    await handle.db.update(sources).set({ via: "muse_fetch" }).where(eq(sources.id, secondary));

    const result = await scorecard(db(), { batchId });
    expect(result.runs[0]?.verificationByGrade).toEqual({
      primary: { verified: 0, verifiedValue: 1, docOnly: 0, mismatch: 0, unverified: 0 },
      secondary: { verified: 1, verifiedValue: 0, docOnly: 0, mismatch: 0, unverified: 0 },
    });
    expect(result.totals.verificationByGrade).toEqual(result.runs[0]?.verificationByGrade);
    // Batch totals carry verified_value (not dropped).
    expect(result.totals.verification.verifiedValue).toBe(1);
    expect(result.runs[0]?.searches).toEqual({
      total: 2,
      byArea: { product: 1, unattributed: 1 },
      withCapturePct: 0.5,
      museFetchFallbacks: 1,
    });
    expect(result.totals.searches).toEqual(result.runs[0]?.searches);
  });

  it("resolves run ids, totals several runs, and rejects unknowns", async () => {
    const companyId = await makeCompany();
    const batchId = randomUUID();
    const a = await makeAgentRun(companyId, batchId);
    const b = await makeAgentRun(companyId, batchId);
    const byId = await scorecard(db(), { runIds: [a, b, a] });
    expect(byId.runs).toHaveLength(2);
    expect(byId.totals.runs).toBe(2);
    expect(byId.totals.tokens.input).toBe(2000);
    const other = await makeAgentRun(companyId, randomUUID());
    const batchOnly = await scorecard(db(), { batchId });
    expect(batchOnly.runs.map((r) => r.runId).sort()).toEqual([a, b].sort());
    expect(other).toBeTruthy();
    await expect(scorecard(db(), { batchId: randomUUID() })).rejects.toBeInstanceOf(DomainError);
    await expect(scorecard(db(), { runIds: [randomUUID()] })).rejects.toBeInstanceOf(DomainError);
    await expect(scorecard(db(), { runIds: [] })).rejects.toBeInstanceOf(DomainError);
  });

  function db() {
    return handle.db;
  }
});
