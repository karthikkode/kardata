import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { benchmarkComparableJobs, benchmarkFeeJobs, blobs, facts, harnessSettings, sectorCompanies, sources } from "../../src/db/schema.js";
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
import * as codexStatus from "../../src/harness/codex-status.js";
import { codexExtractArgs } from "../../src/harness/codex-config.js";

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

async function fixture(twoReadings = false) {
  await tool("evidence_library_ensure");
  const { sector } = await tool("sector_create", { name: "ria-us" }) as { sector: { id: string } };
  const evidence = new Map<string, ReturnType<typeof comparableFixture>>(), companyIds: string[] = [];
  for (const options of [{}, { strategy: true }, { minimum: 10_000_000, waivable: true }]) {
    const { company } = await tool("company_add", { sectorId: sector.id, name: "Synthetic comparable review" }) as { company: { id: string } };
    companyIds.push(company.id);
    const f = comparableFixture({ ...options, twoReadings });
    const text = f.passages.map(row => row.text).join("\n");
    const { sourceId } = await tool("source_capture", { companyId: company.id, url: "https://www.sec.gov/synthetic-comparable.pdf",
      text, via: "browser", passages: [text] }) as { sourceId: string };
    for (const passage of f.passages) passage.sourceId = sourceId;
    evidence.set(company.id, f);
    const [source] = await handle.db.select().from(sources).where(eq(sources.id, sourceId));
    const qualifiers = { input: randomUUID(), extraction: FEE_VERSION };
    const tiers = twoReadings ? [{ from: 0, to: 500_000, rate_pct: 2 }, { from: 500_000, to: null, rate_pct: 1 }] :
      [{ from: 0, to: null, rate_pct: 1 }];
    const saved = await addFacts(handle.db, { companyId: company.id, runId: source!.runId, createdBy: FEE_COLLECTOR, facts: [{
      key: "fee_schedule.status", value: "available", qualifiers, sourceIds: [sourceId], asOf: "2026-01-01",
    }, {
      key: "firm.fee_schedule", qualifiers, sourceIds: [sourceId], asOf: "2026-01-01", value: {
        method: twoReadings ? null : "cliff", tiers, minimumAnnualFee: null, minimumAccountSize: null, flags: twoReadings ? ["tier_method_unclear"] : [],
        at1m: twoReadings ? null : { dollars: 10_000, rate_pct: 1 }, at5m: twoReadings ? null : { dollars: 50_000, rate_pct: 1 },
        scenarios: twoReadings ? { cliff: { at1m: { dollars: 10_000, rate_pct: 1 }, at5m: { dollars: 50_000, rate_pct: 1 } },
          marginal: { at1m: { dollars: 15_000, rate_pct: 1.5 }, at5m: { dollars: 55_000, rate_pct: 1.1 } } } : null,
        primaryScheduleIndex: 0, classification: "comparable", terms: {},
        schedules: [{ name: "Investment management", category: "standard", role: "primary", pricing: "annual_aum", method: twoReadings ? null : "cliff", tiers, terms: [],
          scope: { ref: f.passages[1]!.ref, quote: f.passages[1]!.text, sourceId, kind: "firm", page: 5, date: "2026-01-01" } }],
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
    expect(Object.keys(JSON.parse(request.schema!).properties)).toEqual(["scope", "minimum", "pricing", "sections"]);
    return { json: evidence.get(fee.companyId)!.answer, usage: { inputTokens: 1000, outputTokens: 100, cachedTokens: 0, reasoningTokens: 0, calls: 1 } };
  });
  return { sectorId: sector.id, companyIds, evidence, mockReview };
}

async function seedSnapshot(companyIds: string[]) {
  const file = await handle.db.transaction(tx => canonicalFile(tx, { collector: SNAPSHOT_COLLECTOR, release: "2026-11",
    url: "https://www.sec.gov/synthetic-current.zip", filename: "Synthetic current snapshot", digest: "synthetic" }));
  for (const companyId of companyIds) {
    const citation = await companyFileEvidence(handle.db, file, companyId, { verification: "verified", filingDate: "2026-01-01" });
    const numbers = { "firm.accounts": 100, "firm.regulatory_aum": 100_000_000, "financials.employees": 10,
      "sec_adv.advisory_staff": 5, "firm.client_total": 60, "sec_adv.aum_individuals": 100_000_000, "sec_adv.aum_hnw": 0 };
    const saved = await addFacts(handle.db, { companyId, runId: citation.runId, createdBy: SNAPSHOT_COLLECTOR,
      facts: Object.entries(numbers).map(([key, value]) => ({ key, value, sourceIds: [citation.id], asOf: "2026-01-01", qualifiers: { snapshot: "2026-11" } })) });
    expect(saved.every(row => row.ok)).toBe(true);
  }
  await handle.db.update(facts).set({ verification: "verified" }).where(eq(facts.createdBy, SNAPSHOT_COLLECTOR));
}

it("uses high Codex effort only in the comparable worker and retains a preferred negotiable account minimum", async () => {
  const f = await fixture(), companyId = f.companyIds[0]!;
  const evidence = comparableFixture({ minimum: 2_000_000, preferredAccountMinimum: true, waivable: true });
  for (const p of evidence.passages) p.sourceId = f.evidence.get(companyId)!.passages[0]!.sourceId;
  f.evidence.set(companyId, evidence);
  const args = () => codexExtractArgs({ runId: "synthetic", area: "other", inputDir: "/tmp/synthetic" });
  expect(args()).toContain('model_reasoning_effort="medium"');
  const before = await handle.db.select().from(facts).where(eq(facts.key, "firm.fee_schedule"));
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId], concurrency: 1 });
  await createComparableReviewWorker(handle.db, {
    gate: async () => ({ mode: "auto", provider: "codex", available: true, reason: null }),
    review: (db, fee) => reviewComparable(db, fee, async request => {
      await Promise.resolve();
      expect(args()).toContain('model_reasoning_effort="high"');
      expect(request.prompt).toContain("even when worded as generally prefers a minimum account size");
      return { json: evidence.answer, usage: undefined };
    }),
  }).tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ version: "adv-comparable-v6", status: "completed",
    counts: { conditional: 1 }, results: [expect.objectContaining({ providers: ["codex"], review: expect.objectContaining({
      minimum: expect.objectContaining({ kind: "account_minimum", amount: 2_000_000 }),
      balances: { at1m: "waiver_required", at5m: "available" },
    }) })] });
  expect(args()).toContain('model_reasoning_effort="medium"');
  expect(await handle.db.select().from(facts).where(eq(facts.key, "firm.fee_schedule"))).toEqual(before);
});

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

it.each([
  "extraction container exited 1: transport error: error sending request for url (https://api.fixture.example/responses)",
  "Codex extraction failed (transport)",
  "Codex extraction failed (timeout)",
  "network connection could not be opened within 15 seconds (after 2 provider attempts)",
])("recovers one comparable transport failure and reports its retry: %s", async message => {
  const f = await fixture(), companyId = f.companyIds[0]!;
  const before = await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR));
  const review = vi.fn(f.mockReview).mockRejectedValueOnce(Error(message)), wait = vi.fn(async () => undefined);
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId] });
  await createComparableReviewWorker(handle.db, { gate: ready, review, wait }).tick();
  expect(review).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "completed",
    counts: { pass: 1 }, results: [expect.objectContaining({ attempts: 2, retryCount: 1, usageIncomplete: true,
      attemptErrors: [{ attempt: 1, provider: "muse", reason: message }], outcome: "pass" })] });
  expect(await handle.db.select().from(facts).where(eq(facts.key, COMPARABLE_REVIEW_KEY))).toHaveLength(1);
  expect(await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR))).toEqual(before);
  expect(FEE_VERSION).toBe("adv-2a-v8");
});

it.each([
  ["transport error: connection reset", 2],
  ["invalid structured response", 1],
  ["transport error: unauthorized 401", 1],
  ["Codex extraction requires login (provider)", 1],
])("bounds comparable retries and keeps exhausted errors visible: %s", async (message, attempts) => {
  const f = await fixture(), review = vi.fn(f.mockReview).mockRejectedValue(Error(message)), wait = vi.fn(async () => undefined);
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [f.companyIds[0]!] });
  await createComparableReviewWorker(handle.db, { gate: ready, review, wait }).tick();
  expect(review).toHaveBeenCalledTimes(attempts); expect(wait).toHaveBeenCalledTimes(attempts - 1);
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "completed",
    counts: { error: 1 }, results: [expect.objectContaining({ reason: message, attempts, retryCount: attempts - 1,
      attemptErrors: Array.from({ length: attempts }, (_, i) => ({ attempt: i + 1, provider: "muse", reason: message })) })] });
  expect(await handle.db.select().from(facts).where(eq(facts.key, COMPARABLE_REVIEW_KEY))).toHaveLength(0);
});

it("pauses a quota response without retrying transport or controlling extraction", async () => {
  const f = await fixture(), review = vi.fn(f.mockReview).mockRejectedValue(Error("Subscription quota exhausted: transport error"));
  const wait = vi.fn(async () => undefined), before = await handle.db.select().from(benchmarkFeeJobs);
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [f.companyIds[0]!] });
  await createComparableReviewWorker(handle.db, { gate: ready, review, wait }).tick();
  expect(review).toHaveBeenCalledOnce(); expect(wait).not.toHaveBeenCalled();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "paused", reason: "provider_quota", finished: 0 });
  expect(await handle.db.select().from(benchmarkFeeJobs)).toEqual(before);
});

it.each(["muse_quota", "codex_auth"])("rechecks readiness after backoff and leaves a newly held firm pending: %s", async reason => {
  const f = await fixture(), review = vi.fn(f.mockReview).mockRejectedValue(Error("transport error"));
  const gate = vi.fn(async () => ({ ...await ready(), available: false, reason: reason as string | null }))
    .mockResolvedValueOnce(await ready()).mockResolvedValueOnce(await ready());
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [f.companyIds[0]!] });
  await createComparableReviewWorker(handle.db, { gate, review, wait: async () => undefined }).tick();
  expect(review).toHaveBeenCalledOnce();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "paused", reason, finished: 0 });
});

it("parks a review stopped during backoff and resumes it through a new worker", async () => {
  const f = await fixture(), review = vi.fn(f.mockReview).mockRejectedValueOnce(Error("transport error"));
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [f.companyIds[0]!] });
  const worker = createComparableReviewWorker(handle.db, { gate: ready, review, wait: async () => { worker.stop(); } });
  await worker.tick(); expect(review).toHaveBeenCalledOnce();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "queued", finished: 0 });
  await createComparableReviewWorker(handle.db, { gate: ready, review }).tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "completed", counts: { pass: 1 } });
});

it.each(["ready", "quota", "auth", "hold", "explicit_muse"])("uses ready Codex for an auto-mode comparable retry only: %s", async condition => {
  const f = await fixture(), companyId = f.companyIds[0]!, mode = condition === "explicit_muse" ? "muse" : "auto";
  await handle.db.insert(harnessSettings).values([
    { key: "ria_extractor_provider", value: { mode } },
    { key: "quota_snapshot", value: { checkedAt: new Date().toISOString(), fivePct: 0, weeklyPct: 0,
      fiveResetAt: new Date(Date.now() + 3600000).toISOString(), weeklyResetAt: new Date(Date.now() + 86400000).toISOString() } },
    ...(condition === "hold" ? [{ key: "ria_codex_hold", value: { kind: "quota", at: new Date().toISOString(), resumeAt: null } }] : []),
  ]);
  const inspect = vi.spyOn(codexStatus, "readCodexSnapshot").mockResolvedValue({ checkedAt: new Date().toISOString(),
    authenticated: condition !== "auth", modelAvailable: true, error: condition === "auth" ? "not_logged_in" : null,
    primary: { usedPercent: condition === "quota" ? 100 : 20, windowMinutes: 10080, resetsAt: new Date(Date.now() + 86400000).toISOString() }, secondary: null });
  await handle.db.insert(benchmarkFeeJobs).values({ id: randomUUID(), sectorId: f.sectorId, companyIds: f.companyIds,
    eligibleSelected: 3, cohortSize: 3, concurrency: 2, status: "running", leaseId: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) });
  const extractionBefore = await handle.db.select().from(benchmarkFeeJobs);
  const modeBefore = await handle.db.select().from(harnessSettings).where(eq(harnessSettings.key, "ria_extractor_provider"));
  const review = vi.fn(f.mockReview).mockRejectedValueOnce(Error("transport error"));
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId] });
  await createComparableReviewWorker(handle.db, { review, wait: async () => undefined }).tick();
  expect(review).toHaveBeenCalledTimes(2);
  expect(inspect).toHaveBeenCalledTimes(condition === "explicit_muse" ? 0 : 1);
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "completed", counts: { pass: 1 },
    results: [expect.objectContaining({ providers: ["muse", condition === "ready" ? "codex" : "muse"], retryCount: 1 })] });
  expect(await handle.db.select().from(benchmarkFeeJobs)).toEqual(extractionBefore);
  expect(await handle.db.select().from(harnessSettings).where(eq(harnessSettings.key, "ria_extractor_provider"))).toEqual(modeBefore);
});

it("changes benchmark revisions with review evidence, excludes failures, and separates conditional raw values", async () => {
  const f = await fixture();
  await seedSnapshot(f.companyIds);
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

it("selects exact eligible comparables by default and rejects explicit firms without a benchmark fee output", async () => {
  const f = await fixture();
  const { company } = await tool("company_add", { sectorId: f.sectorId, name: "Synthetic without published price" }) as { company: { id: string } };
  await handle.db.update(sectorCompanies).set({ eligibility: "eligible" }).where(eq(sectorCompanies.sectorId, f.sectorId));
  expect(await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId })).toMatchObject({ selected: 3 });
  const bad = await client.callTool({ name: "benchmark_fee_comparable_run", arguments: { sectorId: f.sectorId, companyIds: [company.id] } });
  expect(bad.isError).toBe(true);
});

it("selects numeric two-reading firms by default and explicit IDs, retaining only passing or conditional endpoints", async () => {
  const f = await fixture(true);
  await seedSnapshot(f.companyIds);
  await handle.db.update(sectorCompanies).set({ eligibility: "eligible" }).where(eq(sectorCompanies.sectorId, f.sectorId));
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId });
  expect(job).toMatchObject({ selected: 3 });
  expect(await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: f.companyIds })).toMatchObject({ jobId: job.jobId, selected: 3 });
  const before = await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR));
  await createComparableReviewWorker(handle.db, { review: f.mockReview, gate: ready }).tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "completed", counts: { pass: 1, fail: 1, conditional: 1 } });
  const computed = await tool("benchmark_compute", { sectorId: f.sectorId, formulaVersion: "synthetic-two-reading-v1",
    snapshots: { current: "2026-11", prior1: "2025-12", prior3: "2023-11" } });
  const rows = await handle.db.select().from(facts).where(and(eq(facts.key, "benchmark.measures"),
    eq(facts.qualifiers, { formula: "synthetic-two-reading-v1", snapshot: "2026-11", revision: computed.revision as string })));
  const results = new Map(rows.map(row => [row.companyId, row.valueJson]));
  expect(results.get(f.companyIds[0]!)).toMatchObject({ feeEligibility: { status: "pass" },
    values: { fee_1m_dollars: null, fee_5m_dollars: null },
    feeRanges: { fee_1m_dollars: { low: 10_000, high: 15_000 }, fee_5m_dollars: { low: 50_000, high: 55_000 } } });
  expect(results.get(f.companyIds[1]!)).toMatchObject({ feeEligibility: { status: "fail" }, feeRanges: {} });
  expect(results.get(f.companyIds[2]!)).toMatchObject({ feeEligibility: { status: "conditional" }, feeRanges: {},
    conditionalFeeValues: { ranges: { fee_1m_dollars: { low: 10_000, high: 15_000 }, fee_5m_dollars: { low: 50_000, high: 55_000 },
      fee_1m_pct: { low: 1, high: 1.5 }, fee_5m_pct: { low: 1, high: 1.1 } } } });
  expect(await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR))).toEqual(before);
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

it.each([false, true])("reviews the archived stored PDF with a textless page=%s", async unread => {
  const f = await fixture(), companyId = f.companyIds[0]!, prior = f.evidence.get(companyId)!;
  const sourceId = prior.passages[0]!.sourceId;
  const body = Buffer.from("%PDF- synthetic parser fixture"), sha256 = createHash("sha256").update(body).digest("hex");
  await handle.db.insert(blobs).values({ sha256, gzip: gzipSync(body), size: body.length, contentType: "application/pdf" });
  await handle.db.update(sources).set({ blobSha256: sha256 }).where(eq(sources.id, sourceId));
  vi.mocked(brochures.loadBrochureEvidence).mockResolvedValue({ passages: [], item5: [], complete: true, gaps: [],
    firmFound: true, sourceIds: [], date: "2026-02-01" });
  vi.spyOn(pdf, "pdfReviewPages").mockResolvedValue([...prior.passages.map(row => row.text), ...(unread ? [" "] : [])]);
  const answer = structuredClone(prior.answer);
  const update = (citation: { ref: string; page: number }, page: number) => { citation.ref = `stored-${sourceId}-p${page}`; citation.page = page; };
  update(answer.scope.evidence, 1); update(answer.minimum.evidence, 3);
  update(answer.pricing.evidence, 2);
  for (const reading of answer.pricing.readings) update(reading.evidence, 2);
  update(answer.sections.item4, 1); update(answer.sections.item5, 2); update(answer.sections.item7, 3);
  const extractor = vi.fn(async (request: { prompt: string }) => {
    if (unread) expect(request.prompt).toContain('"unreadPages":[4]');
    return { json: answer, usage: undefined };
  });
  const review: typeof reviewComparable = (db, fee) => reviewComparable(db, fee, extractor);
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId] });
  await createComparableReviewWorker(handle.db, { review, gate: ready }).tick();
  expect(extractor).toHaveBeenCalledOnce();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ counts: unread ? { unclear: 1 } : { pass: 1 },
    results: [expect.objectContaining({ review: expect.objectContaining({ brochureDate: "2026-01-01", scope: expect.objectContaining({ evidence: expect.objectContaining({ page: 1, sourceId }) }) }) })] });
});


it("calls the model with named textless pages, allowing grounded restrictions only", async () => {
  const f = await fixture();
  vi.mocked(brochures.loadBrochureEvidence).mockImplementation(async (_db, companyId) => {
    const e = f.evidence.get(companyId)!;
    return { ...e, complete: false, gaps: [`No text layer on page 9 of b-${e.passages[0]!.sourceId}; original PDF requires visual review`],
      firmFound: true, item5: [e.passages[1]!], sourceIds: [e.passages[0]!.sourceId], date: "2026-01-01" };
  });
  const extractor = vi.fn(async (request: Parameters<Parameters<typeof reviewComparable>[2]>[0]) => {
    expect(request.prompt).toContain('"unreadPages":[9]');
    expect(request.prompt).toContain("firm-wide investing style");
    expect(request.prompt).toContain("net_worth_target");
    expect(request.prompt).toContain("relationship_preference");
    expect(request.prompt).toContain("either/or");
    expect(request.prompt).toContain("Every other outcome must stay unclear");
    const e = [...f.evidence.values()].find(e => request.prompt.includes(e.passages[0]!.sourceId))!;
    return { json: e.answer, usage: undefined };
  });
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: f.companyIds });
  await createComparableReviewWorker(handle.db, { gate: ready, review: (db, fee) => reviewComparable(db, fee, extractor) }).tick();
  expect(extractor).toHaveBeenCalledTimes(3);
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ status: "completed", counts: { unclear: 2, fail: 1 },
    results: expect.arrayContaining([expect.objectContaining({ review: expect.objectContaining({ reasons: expect.arrayContaining([expect.stringContaining("page 9")]) }) })]) });
});
it.each(["adv-comparable-v1", "adv-comparable-v2", "adv-comparable-v3", "adv-comparable-v4", "adv-comparable-v5"])("excludes dated %s review facts from a new benchmark revision", async version => {
  const f = await fixture(); await seedSnapshot(f.companyIds);
  await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: f.companyIds });
  await createComparableReviewWorker(handle.db, { gate: ready, review: f.mockReview }).tick();
  const reviews = await handle.db.select().from(facts).where(eq(facts.key, COMPARABLE_REVIEW_KEY));
  for (const row of reviews) await handle.db.update(facts).set({ qualifiers: { ...row.qualifiers, review: version },
    valueJson: { ...row.valueJson as object, version } }).where(eq(facts.id, row.id));
  const r = await tool("benchmark_compute", { sectorId: f.sectorId, formulaVersion: "synthetic-version-boundary",
    snapshots: { current: "2026-11", prior1: "2025-12", prior3: "2023-11" } });
  expect(await tool("benchmark_report", { sectorId: f.sectorId, revision: r.revision })).toMatchObject({ benchmark: {
    comparableReviews: { unreviewed: 3 }, measures: { fee_1m_dollars: { value: 0, missing: 3 } },
  } });
});

it.each([false, true])("reviews the selected asset-class table before firm context, withholding two-reading=%s output", async twoReadings => {
  const f = await fixture(twoReadings), companyId = f.companyIds[0]!, original = f.evidence.get(companyId)!;
  const restricted = comparableFixture({ scope: "asset_class", twoReadings });
  for (const passage of restricted.passages) passage.sourceId = original.passages[0]!.sourceId;
  f.evidence.set(companyId, restricted);
  await seedSnapshot(f.companyIds);
  const before = await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR));
  const extractor = vi.fn(async (request: Parameters<Parameters<typeof reviewComparable>[2]>[0]) => {
    expect(request.prompt).toContain("A general description of the firm's services cannot broaden the priced schedule");
    expect(request.prompt).toContain("This requires that the selected rates cover the whole portfolio");
    expect(request.prompt).toContain("including when other asset classes have separate tables");
    expect(request.prompt).toContain("A stored primary role or standard label is not evidence");
    expect(request.prompt).toContain(JSON.stringify(restricted.passages[0]!.text));
    expect(request.prompt).toContain(JSON.stringify(restricted.passages[1]!.text));
    expect(JSON.parse(request.schema!).properties.scope.properties.category.enum).toContain("asset_class");
    return { json: restricted.answer, usage: undefined };
  });
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId] });
  await createComparableReviewWorker(handle.db, { gate: ready,
    review: (db, fee) => reviewComparable(db, fee, extractor) }).tick();
  expect(extractor).toHaveBeenCalledOnce();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({
    version: "adv-comparable-v6", status: "completed", counts: { fail: 1 },
    results: [expect.objectContaining({ review: expect.objectContaining({ scope: expect.objectContaining({
      category: "asset_class", evidence: expect.objectContaining({ page: 5 }),
    }) }) })],
  });
  const computed = await tool("benchmark_compute", { sectorId: f.sectorId, formulaVersion: "synthetic-priced-scope",
    snapshots: { current: "2026-11", prior1: "2025-12", prior3: "2023-11" } });
  const [row] = await handle.db.select().from(facts).where(and(eq(facts.companyId, companyId),
    eq(facts.key, "benchmark.measures"), eq(facts.qualifiers, {
      formula: "synthetic-priced-scope", snapshot: "2026-11", revision: computed.revision as string,
    })));
  expect(row!.valueJson).toMatchObject({ feeEligibility: { status: "fail", version: "adv-comparable-v6" },
    values: { fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null }, feeRanges: {} });
  expect(await tool("benchmark_report", { sectorId: f.sectorId, revision: computed.revision })).toMatchObject({
    benchmark: { comparableReviews: { fail: 1, unreviewed: 2 }, measures: { fee_1m_dollars: { value: 0 } } },
  });
  expect(await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR))).toEqual(before);
});

it.each([false, true])("withholds annual-floor contradictions from stored exact/two-reading=%s facts without re-extraction", async twoReadings => {
  const f = await fixture(twoReadings), companyId = f.companyIds[0]!, old = f.evidence.get(companyId)!;
  const evidence = comparableFixture({ annualFloorConflict: true, twoReadings });
  for (const passage of evidence.passages) passage.sourceId = old.passages[0]!.sourceId;
  f.evidence.set(companyId, evidence); await seedSnapshot(f.companyIds);
  const before = await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR));
  const extractor = vi.fn(async (request: Parameters<Parameters<typeof reviewComparable>[2]>[0]) => {
    expect(request.prompt).toContain("including annual minimum fees outside Item 5");
    expect(request.prompt).toContain("even when the adviser may waive or reduce the floor");
    expect(request.prompt).toContain("current schedule's effective/start date");
    expect(request.prompt).toContain("Separate prices for optional services");
    expect(request.prompt).toContain("rather than a nearby parent heading alone");
    expect(request.prompt).toContain('"existingMinimumAnnualFee":null');
    if (twoReadings) expect(request.prompt).toContain('"existingScenarios":{"cliff"');
    return { json: evidence.answer, usage: undefined };
  });
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId] });
  await createComparableReviewWorker(handle.db, { gate: ready,
    review: (db, fee) => reviewComparable(db, fee, extractor) }).tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({
    version: "adv-comparable-v6", status: "completed", counts: { fail: 1 }, results: [expect.objectContaining({
      review: expect.objectContaining({ pricing: expect.objectContaining({ status: "contradicted", evidence: expect.objectContaining({ page: 6 }) }) }),
    })],
  });
  const computed = await tool("benchmark_compute", { sectorId: f.sectorId, formulaVersion: "synthetic-price-consistency",
    snapshots: { current: "2026-11", prior1: "2025-12", prior3: "2023-11" } });
  const [row] = await handle.db.select().from(facts).where(and(eq(facts.companyId, companyId),
    eq(facts.key, "benchmark.measures"), eq(facts.qualifiers, {
      formula: "synthetic-price-consistency", snapshot: "2026-11", revision: computed.revision as string,
    })));
  expect(row!.valueJson).toMatchObject({ feeEligibility: { status: "fail" }, feeRanges: {},
    values: { fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null } });
  expect(await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR))).toEqual(before);
});

it.each([false, true])("rejects a locally contradicted hybrid price, preserving exact/two-reading=%s extraction", async twoReadings => {
  const f = await fixture(twoReadings), companyId = f.companyIds[0]!, original = f.evidence.get(companyId)!;
  const hybrid = comparableFixture({ hybrid: true });
  for (const passage of hybrid.passages) passage.sourceId = original.passages[0]!.sourceId;
  f.evidence.set(companyId, hybrid);
  const [fee] = await handle.db.select().from(facts).where(and(eq(facts.companyId, companyId), eq(facts.key, "firm.fee_schedule")));
  const old = fee!.valueJson as { schedules: Record<string, unknown>[] } & Record<string, unknown>;
  const tiers = [{ from: 0, to: 2_000_000, rate_pct: 1.1 }, { from: 2_000_000, to: 6_000_000, rate_pct: .7 },
    { from: 6_000_000, to: 12_000_000, rate_pct: .5 }, { from: 12_000_000, to: null, rate_pct: .25 }];
  const scenarios = { cliff: { at1m: { dollars: 11_000, rate_pct: 1.1 }, at5m: { dollars: 35_000, rate_pct: .7 } },
    marginal: twoReadings ? { at1m: { dollars: 11_000, rate_pct: 1.1 }, at5m: { dollars: 43_000, rate_pct: .86 } } : null };
  const method = twoReadings ? null : "cliff";
  await handle.db.update(facts).set({ valueJson: { ...old, tiers, method, scenarios,
    flags: twoReadings ? ["tier_method_unclear"] : [], at1m: twoReadings ? null : scenarios.cliff.at1m, at5m: twoReadings ? null : scenarios.cliff.at5m,
    schedules: [{ ...old.schedules[0], tiers, method, scope: { kind: "firm", page: 5, date: "2026-01-01",
      sourceId: original.passages[0]!.sourceId, ref: hybrid.passages[1]!.ref, quote: hybrid.passages[1]!.text } }],
  } }).where(eq(facts.id, fee!.id));
  await seedSnapshot(f.companyIds);
  const before = await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR));
  const extractor = vi.fn(async (request: Parameters<Parameters<typeof reviewComparable>[2]>[0]) => {
    expect(request.prompt).toContain("You may recompute supplied scenarios internally");
    expect(request.prompt).toContain("A different rule, flat rate, gap or ambiguity in a later band");
    expect(request.prompt).toContain("Matching the published rates alone does not validate a supplied amount");
    expect(request.prompt).toContain('"requiredReadings":[');
    const fields = JSON.parse(request.schema!).properties.pricing.properties.readings.items.properties;
    expect(fields.balance.enum).toEqual(["at1m", "at5m"]);
    const answer = structuredClone(hybrid.answer);
    if (!twoReadings) answer.pricing.readings = answer.pricing.readings.filter(r => r.reading === "cliff").map(r => ({ ...r, reading: "single" }));
    // The overview is deliberately inconsistent: the grounded endpoint verdict
    // must win, rather than allowing the summary to approve the wrong price.
    expect(answer.pricing.status).toBe("supported");
    return { json: answer, usage: undefined };
  });
  const job = await tool("benchmark_fee_comparable_run", { sectorId: f.sectorId, companyIds: [companyId] });
  await createComparableReviewWorker(handle.db, { gate: ready, review: (db, row) => reviewComparable(db, row, extractor) }).tick();
  expect(await tool("benchmark_fee_comparable_status", { jobId: job.jobId })).toMatchObject({ version: "adv-comparable-v6", status: "completed",
    counts: { fail: 1 }, results: [expect.objectContaining({ review: expect.objectContaining({ pricing: expect.objectContaining({
      status: "contradicted", explanation: expect.stringContaining("at5m/"), evidence: expect.objectContaining({ page: 5 }),
    }) }) })] });
  const computed = await tool("benchmark_compute", { sectorId: f.sectorId, formulaVersion: "synthetic-reading-validation",
    snapshots: { current: "2026-11", prior1: "2025-12", prior3: "2023-11" } });
  const [bench] = await handle.db.select().from(facts).where(and(eq(facts.companyId, companyId), eq(facts.key, "benchmark.measures")));
  expect(bench!.valueJson).toMatchObject({ feeEligibility: { status: "fail", version: "adv-comparable-v6" }, feeRanges: {},
    values: { fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null } });
  expect(await tool("benchmark_report", { sectorId: f.sectorId, revision: computed.revision })).toMatchObject({ benchmark: {
    comparableReviews: { fail: 1, unreviewed: 2 }, measures: { fee_1m_dollars: { value: 0 } },
  } });
  expect(await handle.db.select().from(facts).where(eq(facts.createdBy, FEE_COLLECTOR))).toEqual(before);
});
