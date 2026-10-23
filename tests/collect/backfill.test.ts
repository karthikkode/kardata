import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { backfillReviewsOnsite } from "../../src/collect/backfill.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { seedCompany, seedRun } from "./helpers.js";
import { companyJobs, sources } from "../../src/db/schema.js";

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
}

describe("reviews_onsite backfill", () => {
  it("attempts only completed Shopify companies with a supported app and no onsite reviews", async () => {
    const attempted: string[] = [];
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

    const result = await backfillReviewsOnsite(handle.db, {
      executeOne: async (companyId) => {
        attempted.push(companyId);
        return { status: "done", ingested: 7, reason: "7 reviews from 1 pages (Loox)" };
      },
    });
    expect(attempted.sort()).toEqual([a, g].sort());
    expect(result.attempted).toBe(2);
    expect(result.scanned).toBe(4);
    expect(result.ingestedReviews).toBe(14);
    expect(result.nextCursor).toBeNull();
    expect(result.unsupportedApps).toContainEqual({ app: "reviews.io", companies: 2 });
    expect(result.results).toHaveLength(2);
    expect(result.results.find((r) => r.companyId === a)).toMatchObject({ app: "Loox", status: "done", ingested: 7 });
    expect(result.results.find((r) => r.companyId === g)).toMatchObject({ app: "Yotpo", status: "done", ingested: 7 });
  });

  it("pages by cursor", async () => {
    const attempted: string[] = [];
    for (const name of ["P1 Co", "P2 Co", "P3 Co"]) {
      const id = await seedCompany(handle.db, { name });
      await seedCompletedJob(id);
      await seedData(id, { app: "Yotpo", products: true });
    }
    const run = () =>
      backfillReviewsOnsite(handle.db, {
        limit: 2,
        cursor: null,
        executeOne: async (companyId) => {
          attempted.push(companyId);
          return { status: "done", ingested: 1, reason: "ok" };
        },
      });
    const first = await run();
    expect(first.results).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await backfillReviewsOnsite(handle.db, {
      limit: 2,
      cursor: first.nextCursor,
      executeOne: async (companyId) => {
        attempted.push(companyId);
        return { status: "done", ingested: 1, reason: "ok" };
      },
    });
    expect(second.results).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set(attempted).size).toBe(3);
  });

  it("aggregates still-none buckets and survives executor throws", async () => {
    const ids: Record<string, string> = {};
    for (const name of ["B1 Co", "B2 Co", "B3 Co"]) {
      const id = await seedCompany(handle.db, { name });
      ids[name] = id;
      await seedCompletedJob(id);
      await seedData(id, { app: "Stamped", products: true });
    }
    const result = await backfillReviewsOnsite(handle.db, {
      executeOne: async (companyId) => {
        if (companyId === ids["B1 Co"]) return { status: "blocked", ingested: 0, reason: "robots" };
        if (companyId === ids["B2 Co"]) throw new Error("browser exploded");
        return { status: "no_products", ingested: 0, reason: "no product pages collected" };
      },
    });
    expect(result.attempted).toBe(3);
    expect(result.stillNone).toEqual({ blocked: 1, no_products: 1, parse_failed: 1 });
    expect(result.results.find((r) => r.companyName === "B2 Co")).toMatchObject({
      status: "parse_failed",
      reason: "browser exploded",
    });
  });
});
