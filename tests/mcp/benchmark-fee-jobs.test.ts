import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { benchmarkFeeJobs, companies, riaStepRuns, sectorCompanies, sectors } from "../../src/db/schema.js";
import { createBenchmarkFeeWorker } from "../../src/domain/benchmark/fee-jobs.js";
import type { FeeMetrics } from "../../src/domain/benchmark/fees.js";
import { startServer } from "../../src/server.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const handle = getTestDb();
const token = "benchmark-fee-jobs-test";
let server: Awaited<ReturnType<typeof startServer>>;
const client = new Client({ name: "fee-job-test", version: "1" });

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

async function fixture(includeIneligible = false) {
  const sectorId = randomUUID();
  const ids = Array.from({ length: 22 }, () => randomUUID()).sort();
  await handle.db.insert(sectors).values({ id: sectorId, name: "Fee pilot fixtures" });
  await handle.db.insert(companies).values(ids.map(id => ({ id, source: "manual" as const, name: "Synthetic fee firm" })));
  await handle.db.insert(sectorCompanies).values(ids.map((companyId, i) => ({
    companyId, sectorId, addedVia: "manual" as const, eligibility: includeIneligible && i === 0 ? "ineligible" as const : "eligible" as const,
  })));
  return { sectorId, companyIds: ids.slice(0, 20), concurrency: 2 };
}

function result(companyId: string, overrides: Partial<FeeMetrics> = {}): FeeMetrics {
  return { companyId, attempts: 2, retries: 0, unmeteredAttempts: 0, elapsedMs: 500,
    inputTokens: 1_000, outputTokens: 100, outcome: "done", ...overrides };
}

async function tool(name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

async function data(name: string, args: Record<string, unknown>) {
  const response = await tool(name, args);
  expect(response.isError, JSON.stringify(response.structuredContent)).toBeUndefined();
  return response.structuredContent as { jobId: string; status: string };
}

it("returns a job ID, exposes per-firm progress and shares a single durable claim", async () => {
  const input = await fixture();
  const requestId = randomUUID();
  const submissions = await Promise.all([
    data("benchmark_fees_run", { ...input, requestId }),
    data("benchmark_fees_run", { ...input, requestId }),
  ]);
  expect(submissions).toMatchObject(Array(2).fill({ jobId: requestId, status: "queued", selected: 20, finished: 0, cohortSize: 22 }));
  let markLanded!: () => void;
  let releaseWave!: () => void;
  const landed = new Promise<void>(resolve => { markLanded = resolve; });
  const release = new Promise<void>(resolve => { releaseWave = resolve; });
  const reviewed: string[] = [];
  const worker = createBenchmarkFeeWorker(handle.db, async (_db, wave) => {
    for (const id of wave.companyIds) {
      reviewed.push(id);
      await wave.onResult(result(id));
      if (reviewed.length === 1) {
        markLanded();
        await release;
      }
    }
    return null;
  });
  const contender = createBenchmarkFeeWorker(handle.db, async () => { throw new Error("job claimed twice"); });
  const running = worker.tick();
  await landed;
  try {
    await contender.tick();
    expect(await data("benchmark_fees_status", { jobId: requestId })).toMatchObject({
      status: "running", finished: 1, pending: 19, results: [result(input.companyIds[0]!)],
    });
  } finally {
    releaseWave();
    await running;
  }
  expect(reviewed).toEqual(input.companyIds);
  expect(await data("benchmark_fees_status", { jobId: requestId })).toMatchObject({
    status: "completed", finished: 20, pending: 0,
    summary: { measured: 20, meanInputTokens: 1_000, projected: { companies: 22, inputTokens: 22_000 } },
  });
  expect(await data("benchmark_fees_run", { ...input, requestId })).toMatchObject({ jobId: requestId, status: "completed" });
});

it("recovers an expired job lease without rerunning completed work", async () => {
  const input = await fixture(true);
  const { jobId } = await data("benchmark_fees_run", input);
  const first = input.companyIds[0]!;
  await handle.db.update(benchmarkFeeJobs).set({
    status: "running", leaseId: randomUUID(), leaseUntil: new Date(Date.now() - 1_000),
    activeSince: new Date(Date.now() - 10_000), results: { [first]: result(first) },
  }).where(eq(benchmarkFeeJobs.id, jobId));
  const second = input.companyIds[1]!;
  await handle.db.insert(riaStepRuns).values({
    id: randomUUID(), sectorId: input.sectorId, companyId: second, step: "fee_schedule", status: "done",
    tokensUsed: 1_000, telemetry: { ...result(second), feeJobId: jobId },
  });
  const reviewed: string[] = [];
  const worker = createBenchmarkFeeWorker(handle.db, async (_db, wave) => {
    for (const id of wave.companyIds) {
      reviewed.push(id);
      await wave.onResult(result(id));
    }
    return null;
  });
  await worker.tick();
  expect(reviewed).toEqual(input.companyIds.slice(2));
  expect(await data("benchmark_fees_status", { jobId })).toMatchObject({
    status: "completed", finished: 20, eligibleSelected: 19, cohortSize: 21, summary: { projected: null },
  });
});

it("pauses on quota and retains metered work when the job resumes", async () => {
  const input = await fixture();
  const { jobId } = await data("benchmark_fees_run", input);
  const [first, second] = input.companyIds;
  const worker = createBenchmarkFeeWorker(handle.db, async (_db, wave) => {
    await wave.onResult(result(first!, { outcome: "interrupted" }));
    await wave.onResult(result(second!));
    return "quota";
  });
  await worker.tick();
  expect(await data("benchmark_fees_status", { jobId })).toMatchObject({
    status: "paused", reason: "quota", finished: 1, pending: 19,
  });
  expect(await data("benchmark_fees_resume", { jobId })).toMatchObject({ status: "queued" });
  const workerAfterResume = createBenchmarkFeeWorker(handle.db, async (_db, wave) => {
    expect(wave.companyIds).not.toContain(second);
    for (const id of wave.companyIds) await wave.onResult(result(id));
    return null;
  });
  await workerAfterResume.tick();
  expect(await data("benchmark_fees_status", { jobId })).toMatchObject({
    status: "completed", finished: 20,
    results: expect.arrayContaining([result(first!, { attempts: 4, elapsedMs: 1_000, inputTokens: 2_000, outputTokens: 200, models: [] })]),
  });
});

it("stops at the retry threshold and requires an explicit list of distinct active members", async () => {
  const input = await fixture();
  expect((await tool("benchmark_fees_run", { sectorId: input.sectorId })).isError).toBe(true);
  expect((await tool("benchmark_fees_run", { ...input, companyIds: [...input.companyIds, input.companyIds[0]] })).isError).toBe(true);
  expect((await tool("benchmark_fees_run", { ...input, companyIds: [...input.companyIds, randomUUID()] })).isError).toBe(true);
  const { jobId } = await data("benchmark_fees_run", input);
  const worker = createBenchmarkFeeWorker(handle.db, async (_db, wave) => {
    for (const id of wave.companyIds) await wave.onResult(result(id, { attempts: 3, retries: 2 }));
    return null;
  });
  await worker.tick();
  expect(await data("benchmark_fees_status", { jobId })).toMatchObject({
    status: "paused", reason: "retry_threshold", finished: 2, pending: 18,
  });
  expect((await tool("benchmark_fees_resume", { jobId })).isError).toBe(true);
});

it("requires an exclusive full-run opt-in and resumes only the eligible cohort with paged results", async () => {
  const { sectorId, companyIds } = await fixture(true);
  expect((await tool("benchmark_fees_run", { sectorId, fullRun: false })).isError).toBe(true);
  expect((await tool("benchmark_fees_run", { sectorId, fullRun: true, pilot: true })).isError).toBe(true);
  expect((await tool("benchmark_fees_run", { sectorId, fullRun: true, companyIds })).isError).toBe(true);
  const requestId = randomUUID();
  const input = { sectorId, fullRun: true, concurrency: 2, requestId };
  const { jobId } = await data("benchmark_fees_run", input);
  expect(await data("benchmark_fees_run", { ...input, requestId: randomUUID() })).toMatchObject({ jobId, selected: 21 });
  const first = companyIds[1]!;
  const toRemove = companyIds[2]!;
  const worker = createBenchmarkFeeWorker(handle.db, async (_db, wave) => {
    expect(wave.companyIds).toEqual([first, toRemove]);
    await wave.onResult(result(first));
    return "quota";
  });
  await worker.tick();
  expect(await data("benchmark_fees_status", { jobId, limit: 1 })).toMatchObject({
    status: "paused", fullRun: true, selected: 21, eligibleSelected: 21, finished: 1,
    results: [result(first)], nextOffset: 1,
  });
  await handle.db.update(sectorCompanies).set({ eligibility: "ineligible" }).where(and(
    eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, toRemove)));
  await data("benchmark_fees_resume", { jobId });
  const resumed = createBenchmarkFeeWorker(handle.db, async (_db, wave) => {
    expect(wave.companyIds).not.toContain(first);
    expect(wave.companyIds).not.toContain(toRemove);
    expect(wave.companyIds).not.toContain(companyIds[0]);
    for (const id of wave.companyIds) await wave.onResult(result(id));
    return null;
  });
  await resumed.tick();
  expect(await data("benchmark_fees_status", { jobId, offset: 1, limit: 1 })).toMatchObject({
    status: "completed", finished: 21, nextOffset: 2,
    results: [{ companyId: toRemove, outcome: "gap", reason: "company no longer active and eligible" }],
  });
});
