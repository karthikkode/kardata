import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { jobsCollector } from "../../src/collect/collectors/jobs.js";
import { shopifyCollector } from "../../src/collect/collectors/shopify.js";
import { siteCollector } from "../../src/collect/collectors/site.js";
import type { FetchedPage } from "../../src/collect/collectors/types.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import {
  collectorCtx,
  docsForRun,
  factsForRun,
  recordsForRun,
  restoreHostDelay,
  seedCompany,
  seedRun,
  shrinkHostDelay,
} from "./helpers.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "./fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let companyId: string;
let runId: string;
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
  companyId = await seedCompany(handle.db, {
    name: "Fake Skin Co",
    website: site.baseUrl,
    domain: "fakeco.example",
    technologies: ["Shopify", "Klaviyo"],
  });
  runId = await seedRun(handle.db, companyId);
});

afterEach(async () => {
  await site.close();
});

afterAll(async () => {
  restoreHostDelay(delayPrev);
  await handle.close();
});

const recent = new Date();
recent.setMonth(recent.getMonth() - 2);
const recentIso = recent.toISOString();
const oldIso = "2020-03-04T10:00:00Z";

function productsFixture() {
  return {
    products: [
      {
        id: 1,
        title: "Serum",
        handle: "serum",
        product_type: "Skincare",
        tags: "bestseller, vegan",
        created_at: oldIso,
        published_at: recentIso,
        variants: [{ price: "19.00" }, { price: "29.00" }],
      },
      {
        id: 2,
        title: "Cleanser",
        handle: "cleanser",
        product_type: "Skincare",
        tags: "bestseller",
        created_at: oldIso,
        published_at: oldIso,
        variants: [{ price: "12.50" }],
      },
      {
        id: 3,
        title: "Mystery box",
        handle: "mystery-box",
        product_type: "",
        tags: "",
        created_at: null,
        published_at: null,
        variants: [],
      },
    ],
  };
}

describe("shopify collector", () => {
  it("writes catalog stats from products.json, collections and shop currency", async () => {
    site.routes.set("/products.json", (_req, res, url) => {
      if (url.searchParams.get("page") === "2") sendJson(res, { products: [] });
      else sendJson(res, productsFixture());
    });
    site.routes.set("/shop.json", (_req, res) => sendJson(res, { shop: { currency: "USD" } }));
    site.routes.set("/collections.json", (_req, res) =>
      sendJson(res, { collections: [{ title: "Bestsellers" }] }),
    );

    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await shopifyCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "product", status: "done" }]);

    const docs = await docsForRun(handle.db, runId);
    expect(docs).toHaveLength(1);
    const content = docs[0]?.contentMd ?? "";
    expect(content).toContain("Products: 3");
    expect(content).toContain("Skincare: 2");
    expect(content).toContain("(no type): 1");
    expect(content).toContain("Prices (USD):");
    expect(content).toContain("min 12.5, median 19, max 29 (n=3 variants)");
    expect(content).toContain("Variants per product: avg 1.0, min 0, max 2");
    expect(content).toContain("bestseller: 2");
    expect(content).toContain("Bestsellers");
    const launchMonth = `${recent.getUTCFullYear()}-${String(recent.getUTCMonth() + 1).padStart(2, "0")}`;
    expect(content).toContain(`- ${launchMonth}: 1`);
    expect(ctx.shared.shopify?.isShopify).toBe(true);
    expect(ctx.shared.shopify?.products).toHaveLength(3);
    expect(docs[0]?.sourceIds.length).toBeGreaterThan(0);

    const factRows = await factsForRun(handle.db, runId);
    const byKey = new Map(factRows.map((f) => [f.key, f]));
    expect(byKey.get("product.count")?.valueNum).toBe("3");
    expect(byKey.get("product.price_min")?.valueJson).toEqual({ amount: 12.5 });
    expect(byKey.get("product.price_min")?.currency).toBe("USD");
    expect(byKey.get("product.price_median")?.valueJson).toEqual({ amount: 19 });
    expect(byKey.get("product.price_max")?.valueJson).toEqual({ amount: 29 });
    const launchFacts = factRows.filter((f) => f.key === "product.launches_per_month");
    expect(launchFacts).toHaveLength(1);
    expect(launchFacts[0]?.qualifiers).toEqual({ month: launchMonth });
    const typeFacts = factRows.filter((f) => f.key === "product.type_count");
    expect(typeFacts).toHaveLength(2);
    expect(factRows.every((f) => f.createdBy === "collector:shopify")).toBe(true);

    const recordRows = await recordsForRun(handle.db, runId);
    expect(recordRows).toHaveLength(3);
    const serum = recordRows.find((r) => (r.data as Record<string, unknown>)["name"] === "Serum");
    expect(serum?.type).toBe("product");
    expect(serum?.data).toMatchObject({
      url: `${site.baseUrl}/products/serum`,
      price: 19,
      currency: "USD",
      product_type: "Skincare",
      tags: ["bestseller", "vegan"],
    });
    expect(serum?.sourceIds.length).toBeGreaterThan(0);
  });

  it("reports not_found when /products.json is missing and tech is silent", async () => {
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    ctx.effective.technologies = ["WordPress"];
    const result = await shopifyCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "product", status: "not_found", reason: "not a Shopify store (no /products.json)" },
    ]);
    expect(ctx.shared.shopify?.isShopify).toBe(false);
  });

  it("reports not_found with a tech caveat when Apollo lists Shopify but the endpoint is gone", async () => {
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await shopifyCollector.run(ctx);
    expect(result.outcomes).toEqual([
      {
        area: "product",
        status: "not_found",
        reason: "Apollo lists Shopify but /products.json does not answer JSON",
      },
    ]);
  });

  it("reports blocked when the probe is blocked", async () => {
    site.routes.set("/products.json", (_req, res) => sendText(res, "denied", 403, "text/plain"));
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await shopifyCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "product", status: "blocked", reason: "/products.json blocked HTTP 403" },
    ]);
  });
});

function stubHomepageWithLinks(links: string[]): FetchedPage {
  return {
    url: "http://stub/",
    finalUrl: "http://stub/",
    sourceId: "00000000-0000-0000-0000-000000000000",
    title: "stub",
    html: "",
    text: "",
    links: links.map((href) => ({ href, text: "jobs" })),
    scripts: [],
    jsonLd: [],
  };
}

describe("jobs collector", () => {
  it("follows a Greenhouse link from the careers page and lists roles", async () => {
    site.routes.set(
      "/",
      (_req, res) =>
        sendText(res, `<html><head><title>Co</title></head><body><a href="/careers">Careers</a></body></html>`),
    );
    site.routes.set(
      "/careers",
      (_req, res) =>
        sendText(
          res,
          `<html><head><title>Careers</title></head><body><a href="https://boards.greenhouse.io/fakeco">Job board</a></body></html>`,
        ),
    );
    site.routes.set("/v1/boards/fakeco/jobs", (_req, res) =>
      sendJson(res, {
        jobs: [
          {
            title: "Chemist",
            absolute_url: "https://example.invalid/j/1",
            departments: [{ name: "R&D" }],
            offices: [{ name: "Portland" }],
            updated_at: "2026-09-01",
          },
          {
            title: "Designer",
            absolute_url: "https://example.invalid/j/2",
            departments: [{ name: "Design" }],
            location: { name: "Remote" },
          },
        ],
      }),
    );
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    await siteCollector.run(ctx);
    const result = await jobsCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "hiring", status: "done" }]);

    const docs = (await docsForRun(handle.db, runId)).filter((d) => d.createdBy === "collector:jobs");
    expect(docs).toHaveLength(1);
    const content = docs[0]?.contentMd ?? "";
    expect(content).toContain('Board: greenhouse "fakeco"');
    expect(content).toContain("Open roles: 2");
    expect(content).toContain("R&D: 1");
    expect(content).toContain("Portland: 1");
    expect(content).toContain("Remote: 1");
    expect(content).toContain("Chemist (posted 2026-09-01; R&D; Portland)");
    expect(content).toContain("Designer (date not provided; Design; Remote)");

    const factRows = await factsForRun(handle.db, runId);
    const byKey = new Map(factRows.map((f) => [f.key, f]));
    expect(byKey.get("hiring.open_roles")?.valueNum).toBe("2");
    expect(byKey.get("hiring.board")?.valueText).toBe("greenhouse");
    const deptFacts = factRows.filter((f) => f.key === "hiring.open_roles_by_department");
    expect(deptFacts).toHaveLength(2);

    const recordRows = await recordsForRun(handle.db, runId);
    expect(recordRows).toHaveLength(2);
    const chemist = recordRows.find(
      (r) => (r.data as Record<string, unknown>)["title"] === "Chemist",
    );
    expect(chemist?.type).toBe("job_posting");
    expect(chemist?.data).toMatchObject({
      department: "R&D",
      location: "Portland",
      posted_at: "2026-09-01",
      url: "https://example.invalid/j/1",
    });
  });

  it("parses Lever, Ashby and Workable boards linked from the homepage", async () => {
    site.routes.set("/v0/postings/fakeco", (_req, res) =>
      sendJson(res, [
        {
          text: "Engineer",
          hostedUrl: "https://example.invalid/l/1",
          categories: { team: "Eng", location: "Remote", department: "Engineering" },
          createdAt: "2026-08-01",
          salaryRange: "$100k-$120k",
        },
      ]),
    );
    site.routes.set("/posting-api/job-board/fakeco", (_req, res) =>
      sendJson(res, {
        jobs: [
          {
            title: "Marketer",
            location: "NYC",
            department: "Growth",
            publishedAt: "2026-07-01",
            jobUrl: "https://example.invalid/a/1",
            compensation: { compensationTierSummary: "$80K-$90K" },
          },
        ],
      }),
    );
    site.routes.set("/api/v1/widget/accounts/fakeco", (_req, res) =>
      sendJson(res, {
        jobs: [{ title: "Support rep", department: "CX", city: "Austin", shortlink: "https://example.invalid/w/1" }],
      }),
    );
    const cases = [
      {
        link: "https://jobs.lever.co/fakeco",
        want: ["Engineer", "$100k-$120k", 'lever "fakeco"'],
        comp: { comp_min: 100000, comp_max: 120000, currency: "USD" },
      },
      {
        link: "https://jobs.ashbyhq.com/fakeco",
        want: ["Marketer", "$80K-$90K", "NYC"],
        comp: { comp_min: 80000, comp_max: 90000, currency: "USD" },
      },
      {
        link: "https://fakeco.workable.com",
        want: ["Support rep", "Austin", 'workable "fakeco"'],
        comp: null,
      },
    ];
    for (const { link, want, comp } of cases) {
      await resetTestDb(handle);
      const cid = await seedCompany(handle.db, { website: site.baseUrl });
      const rid = await seedRun(handle.db, cid);
      const ctx = await collectorCtx(handle.db, site, cid, rid);
      ctx.shared.site = {
        homepage: stubHomepageWithLinks([link]),
        pages: [],
        productUrls: [],
        sitemapUrls: [],
        socialLinks: [],
      };
      const result = await jobsCollector.run(ctx);
      expect(result.outcomes).toEqual([{ area: "hiring", status: "done" }]);
      const docs = await docsForRun(handle.db, rid);
      for (const needle of want) {
        expect(docs[0]?.contentMd).toContain(needle);
      }
      const recordRows = await recordsForRun(handle.db, rid);
      expect(recordRows).toHaveLength(1);
      if (comp) {
        expect(recordRows[0]?.data).toMatchObject(comp);
      } else {
        expect(recordRows[0]?.data).not.toHaveProperty("comp_min");
      }
    }
  });

  it("reports not_found when no supported board is linked", async () => {
    site.routes.set(
      "/",
      (_req, res) =>
        sendText(res, `<html><head><title>Co</title></head><body><a href="/careers">Careers</a></body></html>`),
    );
    site.routes.set(
      "/careers",
      (_req, res) =>
        sendText(res, `<html><head><title>Careers</title></head><body><p>Email us.</p></body></html>`),
    );
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    await siteCollector.run(ctx);
    const result = await jobsCollector.run(ctx);
    expect(result.outcomes).toEqual([
      {
        area: "hiring",
        status: "not_found",
        reason: "no supported job board linked from the careers page or homepage",
      },
    ]);
  });
});
