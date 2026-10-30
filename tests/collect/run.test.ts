import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { researchRuns, runEvents, sources } from "../../src/db/schema.js";
import { executeCollectRun } from "../../src/collect/run.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import {
  docsForRun,
  factsForRun,
  recordsForRun,
  restoreHostDelay,
  seedCompany,
  seedRun,
  shrinkHostDelay,
  statusesForRun,
} from "./helpers.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "./fake-site.js";

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

function seedFullSite(): void {
  site.routes.set(
    "/",
    (_req, res) =>
      sendText(
        res,
        `<html><head><title>Fake Skin Co</title>
<link rel="alternate" type="application/rss+xml" href="/feed.xml" />
<script type="application/ld+json">{"@type":"Product","aggregateRating":{"ratingValue":"4.8","reviewCount":"120"}}</script>
</head><body>
<a href="/about">About</a>
<a href="/careers">Careers</a>
<script src="https://cdn.klaviyo.com/onsite/js/klaviyo.js"></script>
</body></html>`,
      ),
  );
  site.routes.set(
    "/sitemap.xml",
    (_req, res) =>
      sendText(
        res,
        `<?xml version="1.0"?><urlset><url><loc>${site.baseUrl}/about</loc></url>` +
          `<url><loc>${site.baseUrl}/products/serum</loc></url></urlset>`,
        200,
        "application/xml",
      ),
  );
  site.routes.set("/about", (_req, res) =>
    sendText(res, "<html><head><title>About</title></head><body>We make skincare.</body></html>"),
  );
  site.routes.set("/careers", (_req, res) =>
    sendText(
      res,
      `<html><head><title>Careers</title></head><body><a href="https://boards.greenhouse.io/fakeco">Jobs</a></body></html>`,
    ),
  );
  site.routes.set("/products/serum", (_req, res) =>
    sendText(res, "<html><head><title>Serum</title></head><body>Serum.</body></html>"),
  );
  site.routes.set("/products.json", (_req, res) =>
    sendJson(res, {
      products: [
        {
          id: 1,
          title: "Serum",
          handle: "serum",
          product_type: "Skincare",
          tags: "bestseller",
          published_at: "2026-06-01T00:00:00Z",
          variants: [{ price: "19.00" }],
        },
      ],
    }),
  );
  site.routes.set("/shop.json", (_req, res) => sendJson(res, { shop: { currency: "USD" } }));
  site.routes.set("/collections.json", (_req, res) => sendJson(res, { collections: [] }));
  site.routes.set("/v1/boards/fakeco/jobs", (_req, res) =>
    sendJson(res, {
      jobs: [
        {
          title: "Chemist",
          absolute_url: "https://example.invalid/j/1",
          departments: [{ name: "R&D" }],
          offices: [{ name: "Portland" }],
        },
      ],
    }),
  );
  site.routes.set("/feed.xml", (_req, res) =>
    sendText(
      res,
      `<?xml version="1.0"?><rss><channel><item><title>New launch</title>` +
        `<link>${site.baseUrl}/blog/launch</link><pubDate>${new Date().toUTCString()}</pubDate></item>` +
        `</channel></rss>`,
      200,
      "application/rss+xml",
    ),
  );
  site.routes.set("/api/v2/doc/doc", (_req, res) =>
    sendJson(res, {
      articles: [
        {
          seendate: "2026-10-18T12:00:00Z",
          domain: "beauty.example",
          title: "Fake Skin Co launches",
          url: "https://beauty.example/fake-skin-co",
        },
      ],
    }),
  );
  site.routes.set("/LATEST/search-index", (_req, res) => sendJson(res, { hits: { hits: [] } }));
  site.routes.set("/cdx/search/cdx", (_req, res, url) => {
    if ((url.searchParams.get("url") ?? "").includes("products.json")) {
      sendJson(res, [
        ["timestamp", "original", "statuscode"],
        ["20241020000000", `${site.baseUrl}/products.json`, "200"],
      ]);
      return;
    }
    sendJson(res, [
      ["timestamp", "original", "statuscode"],
      ["20200101000000", "http://fakeco.example/", "200"],
      ["20250101000000", "http://fakeco.example/", "200"],
    ]);
  });
  site.fallback = (_req, res, url) => {
    if (url.pathname.startsWith("/web/")) {
      sendJson(res, {
        products: [{ id: 1, title: "Serum", handle: "serum", variants: [{ price: "15.00" }] }],
      });
    } else {
      sendText(res, "no such route", 404, "text/plain");
    }
  };
}

async function seedUsCompany(): Promise<{ companyId: string; runId: string }> {
  const companyId = await seedCompany(handle.db, {
    name: "Fake Skin Co",
    website: site.baseUrl,
    domain: "fakeco.example",
    country: "United States",
    state: "Oregon",
    technologies: ["Shopify", "Klaviyo"],
    annualRevenue: "5000000",
    employees: 25,
    foundedYear: 2019,
  });
  const runId = await seedRun(handle.db, companyId);
  return { companyId, runId };
}

describe("executeCollectRun", () => {
  it("runs every collector, merges statuses, writes a summary and succeeds", async () => {
    seedFullSite();
    const { runId } = await seedUsCompany();
    const result = await executeCollectRun(handle.db, runId, {
      endpoints: {
        gdelt: site.baseUrl,
        secEfts: site.baseUrl,
        secData: site.baseUrl,
        cdx: site.baseUrl,
        wayback: site.baseUrl,
        greenhouse: site.baseUrl,
        lever: site.baseUrl,
        ashby: site.baseUrl,
        workable: site.baseUrl,
        companiesHouse: site.baseUrl,
      },
      privateHostAllowlist: ["127.0.0.1"],
    });

    expect(result.status).toBe("succeeded");
    const byArea = new Map(result.outcomes.map((o) => [o.area, o.status]));
    expect([...byArea.keys()].sort()).toEqual([
      "business_model",
      "decisions",
      "financials",
      "hiring",
      "marketing",
      "product",
      "reviews",
    ]);
    // decisions: site found no press pages, but feeds/news/wayback carried it.
    expect(byArea.get("decisions")).toBe("done");
    expect(byArea.get("financials")).toBe("done");
    expect([...byArea.values()].every((s) => s === "done")).toBe(true);

    const statuses = await statusesForRun(handle.db, runId);
    expect(statuses).toHaveLength(7);

    const docs = await docsForRun(handle.db, runId);
    const summary = docs.find((d) => d.kind === "summary");
    expect(summary?.contentMd).toContain("- decisions: done");
    expect(summary?.contentMd).toContain("- hiring: done");
    // Every fetched extract carries provenance (the Apollo doc has no sources:
    // import data was never fetched).
    for (const doc of docs.filter((d) => d.kind === "extract" && d.createdBy !== "collector:apollo_profile")) {
      expect(doc.sourceIds.length).toBeGreaterThan(0);
    }

    const factRows = await factsForRun(handle.db, runId);
    expect(factRows.length).toBeGreaterThan(0);
    expect(factRows.map((f) => f.key)).toContain("product.count");
    const recordRows = await recordsForRun(handle.db, runId);
    expect(recordRows.map((r) => r.type).sort()).toEqual([
      "blog_post",
      "job_posting",
      "news_item",
      "product",
    ]);

    const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runId));
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.requestCount).toBeLessThanOrEqual(80);

    const sourceRows = await handle.db.select().from(sources).where(eq(sources.runId, runId));
    expect(sourceRows.every((s) => s.status === "ok")).toBe(true);

    const events = await handle.db.select().from(runEvents).where(eq(runEvents.runId, runId));
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "collector_start")).toHaveLength(13);
    expect(types.filter((t) => t === "collector_end")).toHaveLength(13);
    expect(types.filter((t) => t === "area_status")).toHaveLength(7);
  });

  it("goes partial, not failed, when the homepage is blocked; blocked beats not_found", async () => {
    site.routes.set("/", (_req, res) => sendText(res, "forbidden", 403, "text/plain"));
    const { runId } = await seedUsCompany();
    const result = await executeCollectRun(handle.db, runId, {
      endpoints: {
        gdelt: site.baseUrl,
        secEfts: site.baseUrl,
        secData: site.baseUrl,
        cdx: site.baseUrl,
        wayback: site.baseUrl,
        greenhouse: site.baseUrl,
        lever: site.baseUrl,
        ashby: site.baseUrl,
        workable: site.baseUrl,
        companiesHouse: site.baseUrl,
      },
      privateHostAllowlist: ["127.0.0.1"],
    });
    // A bot wall no longer fails the run: site areas go blocked and the
    // other collectors (Apollo facts etc.) still land.
    expect(result.status).toBe("partial");
    const byArea = new Map(result.outcomes.map((o) => [o.area, o.status]));
    expect(byArea.get("hiring")).toBe("blocked");
    expect(byArea.get("decisions")).toBe("blocked");
    const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runId));
    expect(run?.error).toBeNull();
  });

  it("runs only the requested areas", async () => {
    seedFullSite();
    const { runId } = await seedUsCompany();
    await handle.db
      .update(researchRuns)
      .set({ requestedAreas: ["hiring"] })
      .where(eq(researchRuns.id, runId));
    const result = await executeCollectRun(handle.db, runId, {
      endpoints: {
        gdelt: site.baseUrl,
        secEfts: site.baseUrl,
        secData: site.baseUrl,
        cdx: site.baseUrl,
        wayback: site.baseUrl,
        greenhouse: site.baseUrl,
        lever: site.baseUrl,
        ashby: site.baseUrl,
        workable: site.baseUrl,
        companiesHouse: site.baseUrl,
      },
      privateHostAllowlist: ["127.0.0.1"],
    });
    expect(result.status).toBe("succeeded");
    expect(result.outcomes).toEqual([{ area: "hiring", status: "done" }]);
    expect(await statusesForRun(handle.db, runId)).toHaveLength(1);
  });
});
