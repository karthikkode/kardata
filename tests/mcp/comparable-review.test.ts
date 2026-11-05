import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { benchmarkComparableJobs, benchmarkFeeJobs, blobs, facts, sectorCompanies, sources } from "../../src/db/schema.js";
import { startServer } from "../../src/server.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { comparableFixture } from "../fixtures/comparable-review.js";
import * as brochures from "../../src/domain/benchmark/brochure-review.js";
import { createComparableReviewWorker } from "../../src/domain/benchmark/comparable-jobs.js";
import { COMPARABLE_REVIEW_KEY, reviewComparable } from "../../src/domain/benchmark/comparable-review.js";
import { FEE_COLLECTOR, FEE_VERSION } from "../../src/domain/benchmark/fees.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { canonicalFile, companyFileEvidence, SNAPSHOT_COLLECTOR } from "../../src/domain/sec-adv/evidence.js";
import * as pdf from "../../src/lib/sec/pdf-text.js";

const handle = getTestDb(), client = new Client({ name: "comparable-review-test", version: "1" });
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
const ready = async () => ({ mode: "muse" as const, provider: "muse" as const, available: true, reason: null });

async function fixture() {
  await tool("evidence_library_ensure");
  const { sector } = await tool("sector_create", { name: "ria-us" }) as { sector: { id: string } };
  const evidence = new Map<string, ReturnType<typeof comparableFixture>>(), companyIds: string[] = [];
  for (const options of [{}, { strategy: true }, { minimum: 10_000_000, waivable: true }]) {
    const { company } = await tool("company_add", { sectorId: sector.id, name: "Synthetic comparable review" }) as { company: { id: string } };
    companyIds.push(company.id);
    const f = comparableFixture(options);
    const text = f.passages.map(row => row.text).join("\n");
    const { sourceId } = await tool("source_capture", { companyId: company.id, url: "https://www.sec.gov/synthetic-comparable.pdf",
      text, via: "browser", passages: [text] }) as { sourceId: string };
    for (const passage of f.passages) passage.sourceId = sourceId;
    evidence.set(company.id, f);
    const [source] = await handle.db.select().from(sources).where(eq(sources.id, sourceId));
    const qualifiers = { input: randomUUID(), extraction: FEE_VERSION };
    const tiers = [{ from: 0, to: null, rate_pct: 1 }];
    const saved = await addFacts(handle.db, { companyId: company.id, runId: source!.runId, createdBy: FEE_COLLECTOR, facts: [{
      key: "fee_schedule.status", value: "available", qualifiers, sourceIds: [sourceId], asOf: "2026-01-01",
    }, {
      key: "firm.fee_schedule", qualifiers, sourceIds: [sourceId], asOf: "2026-01-01", value: {
        method: "cliff", tiers, minimumAnnualFee: null, minimumAccountSize: null, flags: [],
        at1m: { dollars: 10_000, rate_pct: 1 }, at5m: { dollars: 50_000, rate_pct: 1 },
        primaryScheduleIndex: 0, classification: "comparable", terms: {},
        schedules: [{ name: "Investment management", category: "standard", role: "primary", pricing: "annual_aum", method: "cliff", tiers, terms: [],
          scope: { ref: f.passages[1]!.ref, quote: "The annual investment management fee is 1% of assets.", sourceId, kind: "firm", page: 5, date: "2026-01-01" } }],
      },
    }] });
    expect(saved.every(row => row.ok)).toBe(true);
  }
  vi.spyOn(brochures, "loadBrochureEvidence").mockImplementation(async (_db, companyId) => ({
    ...evidence.get(companyId)!, complete: true, gaps: [], firmFound: true,
    item5: [evidence.get(companyId)!.passages[1]!], sourceIds: [evidence.get(companyId)!.passages[0]!.sourceId], date: "2026-01-01",
  }));
  const mockReview: typeof reviewComparable = (db, fee) => reviewComparable(db, fee, async request => {
    expect(request.prompt).toContain("Item 4"); expect(request.prompt).toContain("Item 5"); expect(request.prompt).toContain("Item 7");
    expect(Object.keys(JSON.parse(request.schema!).properties)).toEqual(["scope", "minimum", "sections"]);
    return { json: evidence.get(fee.companyId)!.answer, usage: { inputTokens: 1000, outputTokens: 100, cachedTokens: 0, reasoningTokens: 0, calls: 1 } };
  });
  return { sectorId: sector.id, companyIds, evidence, mockReview };
}

it("queues independent reviews, stores dated quoted decisions, and never edits extraction facts or jobs", async () => {
  const f = await fixture(), requestId = randomUUID();
  const extractionJobId = randomUUID();
  await handle.db.insert(benchmarkFeeJobs).values({ id: extractionJobId, sectorId: f.sectorId, companyIds: f.companyIds,
    eligibleSelected: 3, cohortSize: 3, concurrency: 2, status: "running", leaseId: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) });
  const beforeJob = await handle.db.select().from(benchmarkFeeJobs), beforeFacts = await handle.db.select().from(facts);
  const input = { sectorId: f.sectorId, companyIds: f.companyIds, requestId, concurrency: 2 };
  expect(await tool("benchmark_fee_comparable_run", input)).toMatchObject({ jobId: requestId, status: "queued", selected: 3 });
  expect(await tool("benchmark_fee_comparable_run", input)).toMatchObject({ jobId: requestId });
  const worker = createComparableReviewWorker(handle.db, { review: f.mockReview, gate: ready });
  await worker.tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: requestId })).toMatchObject({ status: "completed", finished: 3,
    counts: { pass: 1, fail: 1, conditional: 1 }, tokens: { input: 3000, output: 300 } });
  const reviews = await handle.db.select().from(facts).where(eq(facts.key, COMPARABLE_REVIEW_KEY));
  expect(reviews).toHaveLength(3);
  expect(reviews.every(row => row.asOf === "2026-01-01" && (row.valueJson as { scope: { evidence: { page: number } } }).scope.evidence.page === 4)).toBe(true);
  expect(await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR))).toEqual(beforeFacts);
  expect(await handle.db.select().from(benchmarkFeeJobs)).toEqual(beforeJob);
  expect(FEE_VERSION).toBe("adv-2a-v8");
  expect(await tool("benchmark_fee_comparable_run", input)).toMatchObject({ status: "completed" });
});

it("recovers expired leases, fences stale workers, and never repeats completed firms", async () => {
  const f = await fixture(), calls: string[] = [];
  const request = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: f.companyIds, concurrency: 1 });
  const jobId = request.jobId as string;
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const first = createComparableReviewWorker(handle.db, { gate: ready, review: async (db, fee, call) => {
    calls.push(fee.companyId);
    if (calls.length === 2) { entered(); await barrier; }
    return f.mockReview(db, fee, call);
  } });
  const running = first.tick();
  await waiting;
  const [checkpoint] = await handle.db.select().from(benchmarkComparableJobs).where(eq(benchmarkComparableJobs.id, jobId));
  expect(Object.keys(checkpoint!.results)).toHaveLength(1);
  await handle.db.update(benchmarkComparableJobs).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(benchmarkComparableJobs.id, jobId));
  const resumed: string[] = [];
  const second = createComparableReviewWorker(handle.db, { gate: ready, review: async (db, fee, call) => {
    resumed.push(fee.companyId); return f.mockReview(db, fee, call);
  } });
  await second.tick();
  const committed = await handle.db.select().from(facts).where(eq(facts.key, COMPARABLE_REVIEW_KEY));
  release(); await running;
  expect(resumed).toHaveLength(2);
  expect(resumed).not.toContain(calls[0]);
  expect(await handle.db.select().from(facts).where(eq(facts.key, COMPARABLE_REVIEW_KEY))).toEqual(committed);
  expect(await tool("benchmark_fee_comparable_status", { jobId })).toMatchObject({ status: "completed", finished: 3 });
});

it("pauses only its own review for quota and resumes through the idempotent run tool", async () => {
  const f = await fixture(), requestId = randomUUID();
  const input = { sectorId: f.sectorId, companyIds: f.companyIds, requestId };
  await tool("benchmark_fee_comparable_run", input);
  const worker = createComparableReviewWorker(handle.db, { review: f.mockReview,
    gate: async () => ({ mode: "muse", provider: "muse", available: false, reason: "muse_quota" }) });
  await worker.tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: requestId })).toMatchObject({ status: "paused", finished: 0, reason: "muse_quota" });
  expect(await tool("benchmark_fee_comparable_run", input)).toMatchObject({ status: "queued" });
  await createComparableReviewWorker(handle.db, { review: f.mockReview, gate: ready }).tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: requestId, limit: 1 })).toMatchObject({ status: "completed", finished: 3, nextOffset: 1 });
});

it("changes benchmark revisions with review evidence, excludes failures, and separates conditional raw values", async () => {
  const f = await fixture();
  const file = await handle.db.transaction(tx => canonicalFile(tx, { collector: SNAPSHOT_COLLECTOR, release: "2026-11",
    url: "https://www.sec.gov/synthetic-current.zip", filename: "Synthetic current snapshot", digest: "synthetic" }));
  for (const companyId of f.companyIds) {
    const citation = await companyFileEvidence(handle.db, file, companyId, { verification: "verified", filingDate: "2026-01-01" });
    const numbers = { "firm.accounts": 100, "firm.regulatory_aum": 100_000_000, "financials.employees": 10,
      "sec_adv.advisory_staff": 5, "firm.client_total": 60, "sec_adv.aum_individuals": 100_000_000, "sec_adv.aum_hnw": 0 };
    const saved = await addFacts(handle.db, { companyId, runId: citation.runId, createdBy: SNAPSHOT_COLLECTOR,
      facts: Object.entries(numbers).map(([key, value]) => ({ key, value, sourceIds: [citation.id], asOf: "2026-01-01", qualifiers: { snapshot: "2026-11" } })) });
    expect(saved.every(row => row.ok)).toBe(true);
  }
  await handle.db.update(facts).set({ verification: "verified" }).where(eq(facts.createdBy, SNAPSHOT_COLLECTOR));
  const compute = { sectorId: f.sectorId, formulaVersion: "synthetic-review-v1", snapshots: { current: "2026-11", prior1: "2025-12", prior3: "2023-11" } };
  const previous = await tool("benchmark_compute", compute);
  const extractionBefore = await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR));
  await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: f.companyIds });
  await createComparableReviewWorker(handle.db, { review: f.mockReview, gate: ready }).tick();
  const next = await tool("benchmark_compute", compute);
  expect(next.revision).not.toBe(previous.revision);
  const benchmark = await handle.db.select().from(facts).where(and(eq(facts.key, "benchmark.measures"),
    eq(facts.qualifiers, { formula: "synthetic-review-v1", snapshot: "2026-11", revision: next.revision as string })));
  const byCompany = new Map(benchmark.map(row => [row.companyId, row.valueJson as {
    values: Record<string, unknown>; feeEligibility: { status: string; rawAt1m: unknown };
    conditionalFeeValues: { at1m: unknown; at5m: unknown; estimatedAnnualFeeRevenue: unknown };
  }]));
  expect(byCompany.get(f.companyIds[0]!)).toMatchObject({ feeEligibility: { status: "pass" }, values: { fee_1m_dollars: 10_000, estimated_annual_fee_revenue: 1_000_000 } });
  expect(byCompany.get(f.companyIds[1]!)).toMatchObject({ feeEligibility: { status: "fail" }, values: { fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null } });
  expect(byCompany.get(f.companyIds[2]!)).toMatchObject({ feeEligibility: { status: "conditional" },
    values: { fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null },
    conditionalFeeValues: { at1m: { dollars: 10_000 }, at5m: { dollars: 50_000 }, estimatedAnnualFeeRevenue: 1_000_000 } });
  expect(await tool("benchmark_report", { sectorId: f.sectorId, revision: next.revision })).toMatchObject({ benchmark: {
    comparableReviews: { pass: 1, fail: 1, conditional: 1 }, measures: { fee_1m_dollars: { value: 1, missing: 2 } },
  } });
  expect(await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR))).toEqual(extractionBefore);
});

it("selects only exact eligible comparables by default and rejects explicit firms without one", async () => {
  const f = await fixture();
  const { company } = await tool("company_add", { sectorId: f.sectorId, name: "Synthetic without published price" }) as { company: { id: string } };
  await handle.db.update(sectorCompanies).set({ eligibility: "eligible" }).where(eq(sectorCompanies.sectorId, f.sectorId));
  expect(await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId })).toMatchObject({ selected: 3 });
  const bad = await client.callTool({ name: "benchmark_fee_comparable_run", arguments: { sectorId: f.sectorId, companyIds: [company.id] } });
  expect(bad.isError).toBe(true);
});

it("records a named unclear gap when physical pages are unavailable and makes no model call", async () => {
  const f = await fixture();
  for (const e of f.evidence.values()) for (const passage of e.passages) passage.page = null;
  const extractor = vi.fn().mockRejectedValue(Error("No model call allowed"));
  const review: typeof reviewComparable = (db, fee) => reviewComparable(db, fee, extractor);
  const queued = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: f.companyIds });
  await createComparableReviewWorker(handle.db, { review, gate: ready }).tick();
  expect(extractor).not.toHaveBeenCalled();
  expect(await tool("benchmark_fee_comparable_status", { jobId: queued.jobId })).toMatchObject({
    counts: { unclear: 3 }, results: expect.arrayContaining([expect.objectContaining({
      review: expect.objectContaining({ reasons: expect.arrayContaining(["Primary brochure has no stored physical-page evidence"]) }),
    })]),
  });
});

it("does not silently upgrade a pending job from a different review version", async () => {
  const f = await fixture(), review = vi.fn(f.mockReview);
  const queued = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: f.companyIds });
  await handle.db.update(benchmarkComparableJobs).set({ version: "old-review-version" }).where(eq(benchmarkComparableJobs.id, queued.jobId as string));
  await createComparableReviewWorker(handle.db, { review, gate: ready }).tick();
  expect(review).not.toHaveBeenCalled();
  expect(await tool("benchmark_fee_comparable_status", { jobId: queued.jobId })).toMatchObject({
    status: "failed", reason: "Comparable review version changed; enqueue a new review", finished: 0,
  });
});

it("reviews the exact archived stored PDF when newer documents no longer include it", async () => {
  const f = await fixture(), companyId = f.companyIds[0]!, prior = f.evidence.get(companyId)!;
  const sourceId = prior.passages[0]!.sourceId;
  const body = Buffer.from("%PDF- synthetic parser fixture"), sha256 = createHash("sha256").update(body).digest("hex");
  await handle.db.insert(blobs).values({ sha256, gzip: gzipSync(body), size: body.length, contentType: "application/pdf" });
  await handle.db.update(sources).set({ blobSha256: sha256 }).where(eq(sources.id, sourceId));
  vi.mocked(brochures.loadBrochureEvidence).mockResolvedValue({ passages: [], item5: [], complete: true, gaps: [],
    firmFound: true, sourceIds: [], date: "2026-02-01" });
  vi.spyOn(pdf, "pdfReviewPages").mockResolvedValue(prior.passages.map(row => row.text));
  const answer = structuredClone(prior.answer);
  const update = (citation: { ref: string; page: number }, page: number) => { citation.ref = `stored-${sourceId}-p${page}`; citation.page = page; };
  update(answer.scope.evidence, 1); update(answer.minimum.evidence, 3);
  update(answer.sections.item4, 1); update(answer.sections.item5, 2); update(answer.sections.item7, 3);
  const review: typeof reviewComparable = (db, fee) => reviewComparable(db, fee, async () => ({ json: answer, usage: undefined }));
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId] });
  await createComparableReviewWorker(handle.db, { review, gate: ready }).tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ counts: { pass: 1 },
    results: [expect.objectContaining({ review: expect.objectContaining({ brochureDate: "2026-01-01", scope: expect.objectContaining({ evidence: expect.objectContaining({ page: 1, sourceId }) }) }) })] });
});
