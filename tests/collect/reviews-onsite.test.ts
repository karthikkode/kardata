import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { eq } from "drizzle-orm";
import { runEvents, sources } from "../../src/db/schema.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import { runReviewsOnsite } from "../../src/collect/collectors/reviews-onsite.js";
import type { ReviewsJobOutput, ReviewsJobRunner } from "../../src/harness/reviews.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import {
  collectorCtx,
  recordsForRun,
  restoreHostDelay,
  seedCompany,
  seedRun,
  shrinkHostDelay,
} from "./helpers.js";
import { sendText, startFakeSite, type FakeSite } from "./fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
});

beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) =>
    sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"),
  );
});

afterEach(async () => {
  await site.close();
});

afterAll(async () => {
  restoreHostDelay(delayPrev);
  await handle.close();
});

function host(): string {
  return new URL(site.baseUrl).hostname;
}

async function seedSource(companyId: string, runId: string, url: string): Promise<string> {
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

async function seedShopifyCtx(app: string | null, products: { handle: string; tags: string[] }[]) {
  const companyId = await seedCompany(handle.db, { domain: host() });
  const runId = await seedRun(handle.db, companyId);
  const ctx = await collectorCtx(handle.db, site, companyId, runId);
  ctx.shared.shopify = { checked: true, isShopify: true, products: [], collections: [], productsUrl: null };
  const sourceId = await seedSource(companyId, runId, `${site.baseUrl}/`);
  if (app) {
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:reviews",
      facts: [{ key: "reviews.app", value: app, sourceIds: [sourceId] }],
    });
  }
  for (const p of products) {
    site.routes.set(`/products/${p.handle}`, (_req, res) =>
      sendText(res, `<html><head><title>${p.handle}</title></head><body>product</body></html>`),
    );
  }
  if (products.length > 0) {
    await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:shopify",
      records: products.map((p) => ({
        type: "product",
        data: {
          name: p.handle,
          url: `${site.baseUrl}/products/${p.handle}`,
          ...(p.tags.length > 0 ? { tags: p.tags } : {}),
        },
        sourceIds: [sourceId],
      })),
    });
  }
  return { ctx, runId };
}

function cannedRunner(texts: string[]): ReviewsJobRunner & { seen: string[][] } {
  const seen: string[][] = [];
  const run: ReviewsJobRunner = async (input) => {
    seen.push(input.pages.map((p) => p.url));
    const first = input.pages[0]?.url ?? "";
    const out: ReviewsJobOutput = {
      pages: input.pages.map((p, i) => ({
        url: p.url,
        product: p.url,
        vendor: "judgeme",
        status: "done",
        reviewCount: i === 0 ? texts.length : 0,
      })),
      reviews: texts.map((text) => ({ text, rating: 5, rating_scale: 5, date: "2026-10-01", url: first })),
    };
    return out;
  };
  return Object.assign(run, { seen });
}

describe("reviews_onsite collector", () => {
  it("ingests job reviews citing the page sources", async () => {
    const { ctx, runId } = await seedShopifyCtx("Judge.me", [{ handle: "glow", tags: [] }]);
    const pageUrl = `${site.baseUrl}/products/glow`;
    const runner = cannedRunner(["Synthetic glow review."]);

    const result = await runReviewsOnsite(ctx, runner);
    expect(result.outcomes).toEqual([
      { area: "reviews", status: "done", reason: "1 reviews from 1 pages (Judge.me)" },
    ]);
    expect(runner.seen).toEqual([[pageUrl]]);
    const rows = (await recordsForRun(handle.db, runId)).filter((r) => r.type === "review");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdBy).toBe("collector:reviews_onsite");
  });

  it("stores displayed totals per page and reports them per company", async () => {
    const { ctx, runId } = await seedShopifyCtx("Judge.me", [{ handle: "glow", tags: [] }]);
    const pageUrl = `${site.baseUrl}/products/glow`;
    const runner: ReviewsJobRunner = async (input) => ({
      pages: input.pages.map((p) => ({
        url: p.url,
        product: p.product,
        vendor: "judgeme",
        status: "done",
        reviewCount: 1,
        displayedTotal: 74,
      })),
      reviews: [{ text: "Synthetic glow review.", rating: 5, rating_scale: 5, date: "2026-10-01", url: pageUrl }],
    });

    const result = await runReviewsOnsite(ctx, runner);
    expect(result.outcomes).toEqual([
      { area: "reviews", status: "done", reason: "1 of 74 displayed reviews from 1 pages (Judge.me)" },
    ]);
    const [page] = await handle.db.select().from(sources).where(eq(sources.url, pageUrl));
    expect(page?.details).toEqual({ displayedTotal: 74, ingestedOnPage: 1 });
    const events = await handle.db.select().from(runEvents).where(eq(runEvents.runId, runId));
    const logged = events.find((e) => "reviews_onsite" in (e.payload as Record<string, unknown>));
    expect((logged?.payload as { reviews_onsite: { ingested: number; displayed: number } }).reviews_onsite).toMatchObject({
      ingested: 1,
      displayed: 74,
    });
  });

  it("prefers hero products, caps at 10 pages, skips off-domain urls", async () => {
    const products = Array.from({ length: 12 }, (_, i) => ({
      handle: `p${i}`,
      tags: i === 11 ? ["Bestseller"] : [],
    }));
    const { ctx } = await seedShopifyCtx("Stamped", products);
    // An off-domain product that must never reach the job.
    const companyId = ctx.companyId;
    const runId = ctx.runId;
    const sourceId = await seedSource(companyId, runId, `${site.baseUrl}/`);
    await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "collector:shopify",
      records: [
        {
          type: "product",
          data: { name: "evil", url: "https://evil.example/products/x" },
          sourceIds: [sourceId],
        },
      ],
    });
    const runner = cannedRunner([]);

    const result = await runReviewsOnsite(ctx, runner);
    expect(result.outcomes[0]?.status).toBe("not_found");
    const seen = runner.seen[0] ?? [];
    expect(seen).toHaveLength(10);
    expect(seen[0]).toBe(`${site.baseUrl}/products/p11`);
    expect(seen.every((u) => u.startsWith(site.baseUrl))).toBe(true);
  });

  it("caps ingestion at 300 reviews", async () => {
    const { ctx, runId } = await seedShopifyCtx("Yotpo", [{ handle: "oil", tags: [] }]);
    const reviews = Array.from({ length: 350 }, (_, i) => `Synthetic review ${i}.`);
    const result = await runReviewsOnsite(ctx, cannedRunner(reviews));
    expect(result.outcomes[0]).toMatchObject({ status: "done" });
    const rows = (await recordsForRun(handle.db, runId)).filter((r) => r.type === "review");
    expect(rows).toHaveLength(300);
  });

  it("skips non-Shopify stores and stores without a review app", async () => {
    const companyId = await seedCompany(handle.db, { domain: host() });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    ctx.shared.shopify = { checked: true, isShopify: false, products: [], collections: [], productsUrl: null };
    const notShopify = await runReviewsOnsite(ctx, cannedRunner([]));
    expect(notShopify.outcomes).toEqual([
      { area: "reviews", status: "skipped", reason: "not a Shopify store" },
    ]);

    const { ctx: noApp } = await seedShopifyCtx(null, [{ handle: "glow", tags: [] }]);
    const result = await runReviewsOnsite(noApp, cannedRunner([]));
    expect(result.outcomes).toEqual([
      { area: "reviews", status: "skipped", reason: "no review app detected" },
    ]);
  });

  it("reports unsupported review apps", async () => {
    const { ctx } = await seedShopifyCtx("Trustpilot", [{ handle: "glow", tags: [] }]);
    const result = await runReviewsOnsite(ctx, cannedRunner([]));
    expect(result.outcomes).toEqual([
      { area: "reviews", status: "not_found", reason: "unsupported review app: Trustpilot" },
    ]);
  });

  it("treats robots-disallowed pages as blocked", async () => {
    site.routes.set("/robots.txt", (_req, res) =>
      sendText(res, "User-agent: *\nDisallow: /products/\n", 200, "text/plain"),
    );
    const { ctx } = await seedShopifyCtx("Judge.me", [{ handle: "glow", tags: [] }]);
    const runner = cannedRunner([]);
    const result = await runReviewsOnsite(ctx, runner);
    expect(result.outcomes).toEqual([
      {
        area: "reviews",
        status: "blocked",
        reason: "every product page failed or was robots-disallowed",
      },
    ]);
    expect(runner.seen).toHaveLength(0);
  });
});
