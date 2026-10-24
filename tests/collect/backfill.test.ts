import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { backfillBatchStatus, enqueueReviewsOnsiteBackfill } from "../../src/collect/backfill.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { seedCompany, seedRun } from "./helpers.js";
import { areaStatuses, companyJobs, researchRuns, sources } from "../../src/db/schema.js";

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

async function seedSource(companyId: string, runId: string): Promise<string> {
  const [row] = await handle.db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId,
      runId,
      url: "https://example.test/",
      finalUrl: "https://example.test/",
      collector: "test",
      status: "ok",
      httpStatus: 200,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("no source row");
  return row.id;
}

async function seedCompletedJob(companyId: string): Promise<void> {
  await handle.db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "completed" });
}

async function seedFailedJob(companyId: string): Promise<void> {
  await handle.db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "failed" });
}

async function seedData(companyId: string, opts: { app?: string; products?: boolean; onsite?: boolean }): Promise<void> {
  const runId = await seedRun(handle.db, companyId);
  const sourceId = await seedSource(companyId, runId);
  if (opts.app) {
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:reviews",
      facts: [{ key: "reviews.app", value: opts.app, sourceIds: [sourceId] }],
    });
  }
  if (opts.products) {
    await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:shopify",
      records: [{ type: "product", data: { name: "glow", url: "https://example.test/p/glow" }, sourceIds: [sourceId] }],
    });
  }
  if (opts.onsite) {
    const results = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:reviews_onsite",
      records: [
        {
          type: "review",
          data: { platform: "Loox", text: "old review", date: "2026-01-15" },
          sourceIds: [sourceId],
        },
      ],
    });
    if (results.some((r) => !r.ok)) throw new Error(`review seed failed: ${JSON.stringify(results)}`);
  }
  await handle.db.update(researchRuns).set({ status: "succeeded" }).where(eq(researchRuns.id, runId));
}

describe("reviews_onsite backfill enqueue", () => {
  it("queues onsite-only runs for supported-app candidates", async () => {
    const a = await seedCompany(handle.db, { name: "Candidate Co" });
    await seedCompletedJob(a);
    await seedData(a, { app: "Loox", products: true });
    const b = await seedCompany(handle.db, { name: "Unsupported Co" });
    await seedCompletedJob(b);
    await seedData(b, { app: "Reviews.io", products: true });
    const c = await seedCompany(handle.db, { name: "Done Co" });
    await seedCompletedJob(c);
    await seedData(c, { app: "Yotpo", products: true, onsite: true });
    const d = await seedCompany(handle.db, { name: "Failed Co" });
    await seedFailedJob(d);
    await seedData(d, { app: "Loox", products: true });
    const e = await seedCompany(handle.db, { name: "NoCatalog Co" });
    await seedCompletedJob(e);
    await seedData(e, { app: "Loox" });
    const f = await seedCompany(handle.db, { name: "NoApp Co" });
    await seedCompletedJob(f);
    await seedData(f, { products: true });
    const g = await seedCompany(handle.db, { name: "Joined Co" });
    await seedCompletedJob(g);
    await seedData(g, { app: "Yotpo,Reviews.io", products: true });
    const h = await seedCompany(handle.db, { name: "Alias Co" });
    await seedCompletedJob(h);
    await seedData(h, { app: "stamped.io", products: true });

    const result = await enqueueReviewsOnsiteBackfill(handle.db, {});
    expect(result.batchId).not.toBeNull();
    expect(result.scanned).toBe(5);
    expect(result.queued.map((q) => q.companyId).sort()).toEqual([a, g, h].sort());
    expect(result.queued.find((q) => q.companyId === a)).toMatchObject({ app: "Loox" });
    expect(result.queued.find((q) => q.companyId === g)).toMatchObject({ app: "Yotpo" });
    expect(result.queued.find((q) => q.companyId === h)).toMatchObject({ app: "stamped.io" });
    expect(result.alreadyRunning).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.unsupportedApps).toContainEqual({ app: "reviews.io", companies: 2 });

    const rows = await handle.db.select().from(researchRuns).where(eq(researchRuns.batchId, result.batchId!));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe("queued");
      expect(row.kind).toBe("collect");
      expect(row.requestedAreas).toEqual(["reviews"]);
      expect(row.requestedAdapters).toEqual(["reviews_onsite"]);
    }
  });

  it("reports already-running companies instead of queueing twice", async () => {
    const a = await seedCompany(handle.db, { name: "Candidate Co" });
    await seedCompletedJob(a);
    await seedData(a, { app: "Loox", products: true });
    const liveRunId = await seedRun(handle.db, a);

    const result = await enqueueReviewsOnsiteBackfill(handle.db, {});
    expect(result.batchId).not.toBeNull();
    expect(result.queued).toEqual([]);
    expect(result.alreadyRunning).toEqual([
      { companyId: a, companyName: "Candidate Co", app: "Loox", runId: liveRunId },
    ]);
  });

  it("pages by cursor", async () => {
    for (const name of ["P1 Co", "P2 Co", "P3 Co"]) {
      const id = await seedCompany(handle.db, { name });
      await seedCompletedJob(id);
      await seedData(id, { app: "Yotpo", products: true });
    }
    const first = await enqueueReviewsOnsiteBackfill(handle.db, { limit: 2 });
    expect(first.queued).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await enqueueReviewsOnsiteBackfill(handle.db, { limit: 2, cursor: first.nextCursor });
    expect(second.queued).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const queuedIds = [...first.queued, ...second.queued].map((q) => q.companyId);
    expect(new Set(queuedIds).size).toBe(3);
  });
});

describe("reviews_onsite backfill status", () => {
  async function seedBatchRun(
    batchId: string,
    name: string,
    runStatus: "queued" | "running" | "succeeded" | "failed",
    area?: { status: "done" | "blocked" | "not_found" | "skipped" | "error"; reason: string },
    reviews = 0,
  ): Promise<{ companyId: string; runId: string }> {
    const companyId = await seedCompany(handle.db, { name });
    await seedCompletedJob(companyId);
    const seedId = await seedRun(handle.db, companyId);
    const sourceId = await seedSource(companyId, seedId);
    await addFacts(handle.db, {
      companyId,
      runId: seedId,
      createdBy: "collector:reviews",
      facts: [{ key: "reviews.app", value: "Loox", sourceIds: [sourceId] }],
    });
    await handle.db.update(researchRuns).set({ status: "succeeded" }).where(eq(researchRuns.id, seedId));
    const runId = randomUUID();
    await handle.db.insert(researchRuns).values({
      id: runId,
      companyId,
      kind: "collect",
      status: runStatus,
      batchId,
      requestedAdapters: ["reviews_onsite"],
      error: runStatus === "failed" ? "browser exploded" : null,
    });
    if (area) {
      await handle.db.insert(areaStatuses).values({
        runId,
        area: "reviews",
        companyId,
        status: area.status,
        reason: area.reason,
      });
    }
    for (let i = 0; i < reviews; i += 1) {
      const results = await upsertRecords(handle.db, {
        companyId,
        runId,
        createdBy: "collector:reviews_onsite",
        records: [
          {
            type: "review",
            data: { platform: "Loox", text: `review ${i}`, date: "2026-01-15" },
            sourceIds: [sourceId],
          },
        ],
      });
      if (results.some((r) => !r.ok)) throw new Error(`review seed failed: ${JSON.stringify(results)}`);
    }
    return { companyId, runId };
  }

  it("aggregates per-company outcomes and still-none buckets", async () => {
    const batchId = randomUUID();
    await seedBatchRun(batchId, "Done Co", "succeeded", { status: "done", reason: "7 reviews from 1 pages (Loox)" }, 7);
    await seedBatchRun(batchId, "Blocked Co", "succeeded", { status: "blocked", reason: "robots disallow" });
    await seedBatchRun(batchId, "Noproduct Co", "succeeded", { status: "skipped", reason: "not a Shopify store" });
    await seedBatchRun(batchId, "Parse Co", "succeeded", {
      status: "not_found",
      reason: "no reviews parsed (detected vendor: loox)",
    });
    await seedBatchRun(batchId, "Failed Co", "failed");
    await seedBatchRun(batchId, "Waiting Co", "queued");

    const result = await backfillBatchStatus(handle.db, batchId);
    expect(result.counts).toEqual({ succeeded: 4, failed: 1, queued: 1 });
    expect(result.ingestedReviews).toBe(7);
    expect(result.stillNone).toEqual({ blocked: 1, no_products: 1, parse_failed: 2 });
    const byName = new Map(result.results.map((r) => [r.companyName, r]));
    expect(byName.get("Done Co")).toMatchObject({ status: "done", ingested: 7, app: "Loox" });
    expect(byName.get("Blocked Co")).toMatchObject({ status: "blocked", ingested: 0 });
    expect(byName.get("Noproduct Co")).toMatchObject({ status: "no_products" });
    expect(byName.get("Parse Co")).toMatchObject({ status: "parse_failed" });
    expect(byName.get("Failed Co")).toMatchObject({ status: "parse_failed", reason: "browser exploded" });
    expect(byName.get("Waiting Co")).toMatchObject({ status: "pending", runStatus: "queued" });
  });

  it("throws not_found for an unknown batch", async () => {
    await expect(backfillBatchStatus(handle.db, randomUUID())).rejects.toThrow("batch not found");
  });
});
