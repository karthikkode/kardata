import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies } from "../../src/db/schema.js";
import { siteCollector } from "../../src/collect/collectors/site.js";
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
  sourceById,
} from "./helpers.js";
import { sendText, startFakeSite, type FakeSite } from "./fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let companyId: string;
let runId: string;
let delayPrev: string | undefined;

const page = (title: string, body: string, extra = "") =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p>${extra}</p></body></html>`;

function homepage(extraLinks = ""): string {
  return `<html><head><title>Fake Skin Co</title>
<link rel="alternate" type="application/rss+xml" href="/feed.xml" />
<script type="application/ld+json">{"@type":"Organization","name":"Fake Skin Co"}</script>
</head><body>
<a href="/about">About us</a>
<a href="/blog/launch">Launch news</a>
<a href="/careers">Careers</a>
<a href="/stockists">Stockists</a>
<a href="/subscribe">Subscribe</a>
<a href="/shipping">Shipping</a>
<a href="https://instagram.com/fakeskinco">Instagram</a>
<a href="/products/serum">Serum</a>
${extraLinks}
<script src="https://cdn.klaviyo.com/onsite/js/klaviyo.js"></script>
</body></html>`;
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
});

beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) =>
    sendText(res, `User-agent: *\nDisallow:\nSitemap: ${site.baseUrl}/sitemap.xml\n`, 200, "text/plain"),
  );
  companyId = await seedCompany(handle.db, {
    name: "Fake Skin Co",
    website: site.baseUrl,
    domain: "fakeco.example",
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

function seedStandardSite(): void {
  site.routes.set("/", (_req, res) => sendText(res, homepage()));
  site.routes.set(
    "/sitemap.xml",
    (_req, res) =>
      sendText(
        res,
        `<?xml version="1.0"?><sitemapindex><sitemap><loc>${site.baseUrl}/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
        200,
        "application/xml",
      ),
  );
  site.routes.set(
    "/sitemap-pages.xml",
    (_req, res) =>
      sendText(
        res,
        `<?xml version="1.0"?><urlset><url><loc>${site.baseUrl}/about</loc></url>` +
          `<url><loc>${site.baseUrl}/products/serum</loc></url>` +
          `<url><loc>${site.baseUrl}/blogs/news/launch</loc></url></urlset>`,
        200,
        "application/xml",
      ),
  );
  site.routes.set("/about", (_req, res) => sendText(res, page("About", "We make honest skincare.")));
  site.routes.set("/blog/launch", (_req, res) => sendText(res, page("Launch", "We launched.")));
  site.routes.set(
    "/careers",
    (_req, res) =>
      sendText(
        res,
        page("Careers", "Join us.", `<a href="${site.baseUrl}/boards/greenhouse/fakeco">See jobs</a>`),
      ),
  );
  site.routes.set("/stockists", (_req, res) => sendText(res, page("Stockists", "Find us in stores.")));
  site.routes.set("/subscribe", (_req, res) => sendText(res, page("Subscribe", "Subscribe and save.")));
  site.routes.set("/shipping", (_req, res) => sendText(res, page("Shipping", "Ships in 2 days.")));
}

describe("site collector", () => {
  it("classifies pages and writes business_model, decisions and hiring documents", async () => {
    seedStandardSite();
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await siteCollector.run(ctx);

    expect(result.fatal).toBeUndefined();
    expect(result.outcomes).toEqual([
      { area: "business_model", status: "done" },
      { area: "decisions", status: "done" },
      { area: "hiring", status: "done" },
    ]);

    const docs = await docsForRun(handle.db, runId);
    expect(docs).toHaveLength(3);
    const byArea = new Map(docs.map((d) => [d.area, d]));
    const bm = byArea.get("business_model");
    expect(bm?.createdBy).toBe("collector:site");
    expect(bm?.contentMd).toContain("We make honest skincare.");
    expect(bm?.contentMd).toContain("https://instagram.com/fakeskinco");
    expect(bm?.contentMd).toContain("Fake Skin Co");
    expect(byArea.get("decisions")?.contentMd).toContain("We launched.");
    const hiring = byArea.get("hiring")?.contentMd ?? "";
    expect(hiring).toContain("Join us.");
    expect(hiring).toContain("/boards/greenhouse/fakeco");

    // Every source id resolves to an ok source fetched by this collector.
    for (const doc of docs) {
      expect(doc.sourceIds.length).toBeGreaterThan(0);
      for (const id of doc.sourceIds) {
        const source = await sourceById(handle.db, id);
        expect(source?.status).toBe("ok");
        expect(source?.collector).toBe("site");
      }
    }
    // The site collector writes documents only; facts and records come later.
    expect(await factsForRun(handle.db, runId)).toHaveLength(0);
    expect(await recordsForRun(handle.db, runId)).toHaveLength(0);
    // Nested sitemap was followed; product URLs stashed for later collectors.
    expect(ctx.shared.site?.sitemapUrls).toHaveLength(3);
    expect(ctx.shared.site?.productUrls).toEqual([`${site.baseUrl}/products/serum`]);
    expect(ctx.shared.site?.pages.length).toBeLessThanOrEqual(12);
  });

  it("marks an area blocked when its only page is a challenge page", async () => {
    seedStandardSite();
    site.routes.set("/blog/launch", (_req, res) =>
      sendText(res, `<html><head><title>Just a moment...</title></head><body>cf-chl widget</body></html>`),
    );
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await siteCollector.run(ctx);

    expect(result.outcomes).toEqual([
      { area: "business_model", status: "done" },
      {
        area: "decisions",
        status: "blocked",
        reason: `${site.baseUrl}/blog/launch blocked`,
      },
      { area: "hiring", status: "done" },
    ]);
    const docs = await docsForRun(handle.db, runId);
    expect(docs.map((d) => d.area).sort()).toEqual(["business_model", "hiring"]);
  });

  it("fetches at most 12 classified pages, round-robin across classes", async () => {
    site.routes.set("/", (_req, res) => sendText(res, homepage()));
    const urls = [`${site.baseUrl}/about`];
    for (let i = 0; i < 20; i++) urls.push(`${site.baseUrl}/blog/post-${i}`);
    site.routes.set(
      "/sitemap.xml",
      (_req, res) =>
        sendText(
          res,
          `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
          200,
          "application/xml",
        ),
    );
    site.routes.set("/about", (_req, res) => sendText(res, page("About", "About body.")));
    // Homepage's own classified links 404 (no route); sitemap carries the test.
    site.fallback = (_req, res, url) => {
      if (url.pathname.startsWith("/blog/")) {
        sendText(res, page("Post", `Body ${url.pathname}.`));
      } else {
        sendText(res, "no such route", 404, "text/plain");
      }
    };
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await siteCollector.run(ctx);

    // Exactly 12 classified-page attempts (4 homepage links 404 via the fallback).
    const attempts = site.hits.filter(
      (h) => h.path !== "/" && h.path !== "/robots.txt" && h.path !== "/sitemap.xml",
    );
    expect(attempts).toHaveLength(12);
    expect(ctx.shared.site?.pages.length).toBeLessThanOrEqual(12);
    expect(ctx.shared.site?.pages.length).toBeGreaterThan(0);
    // Round-robin: the lone about page is picked despite 20 blog posts.
    expect(ctx.shared.site?.pages.some((p) => p.page.url.endsWith("/about"))).toBe(true);
    expect(result.outcomes).toContainEqual({ area: "business_model", status: "done" });
    expect(result.outcomes).toContainEqual({ area: "decisions", status: "done" });
  });

  it("returns not_found without a fatal when the company has no website", async () => {
    await handle.db
      .update(companies)
      .set({ website: null, domain: null })
      .where(eq(companies.id, companyId));
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await siteCollector.run(ctx);
    expect(result.fatal).toBeUndefined();
    expect(result.outcomes).toEqual([
      { area: "business_model", status: "not_found", reason: "company has no website or domain" },
      { area: "decisions", status: "not_found", reason: "company has no website or domain" },
      { area: "hiring", status: "not_found", reason: "company has no website or domain" },
    ]);
    expect(site.hits).toHaveLength(0);
  });

  it("returns blocked without a fatal when the homepage is bot-walled", async () => {
    site.routes.set("/", (_req, res) => sendText(res, "forbidden", 403, "text/plain"));
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await siteCollector.run(ctx);
    // A bot wall is not fatal: Apollo facts still land and the research
    // agent gets its chance with the browser fallback.
    expect(result.fatal).toBeUndefined();
    expect(result.outcomes).toEqual([
      { area: "business_model", status: "blocked", reason: "homepage blocked HTTP 403" },
      { area: "decisions", status: "blocked", reason: "homepage blocked HTTP 403" },
      { area: "hiring", status: "blocked", reason: "homepage blocked HTTP 403" },
    ]);
    expect(await docsForRun(handle.db, runId)).toHaveLength(0);
  });

  it("records blocked without a fatal for ria when the homepage is robots-disallowed", async () => {
    site.routes.set("/robots.txt", (_req, res) =>
      sendText(res, "User-agent: *\nDisallow: /\n", 200, "text/plain"),
    );
    site.routes.set("/", (_req, res) => sendText(res, homepage()));
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    (ctx.shared as Record<string, unknown>)["riaPlaybook"] = true;
    const result = await siteCollector.run(ctx);
    expect(result.fatal).toBeUndefined();
    expect(result.outcomes.every((o) => o.status === "blocked")).toBe(true);
  });

  it("fails fatal when the homepage is robots-disallowed", async () => {
    site.routes.set("/robots.txt", (_req, res) =>
      sendText(res, "User-agent: *\nDisallow: /\n", 200, "text/plain"),
    );
    site.routes.set("/", (_req, res) => sendText(res, homepage()));
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await siteCollector.run(ctx);
    expect(result.fatal).toContain("homepage fetch failed");
    expect(result.outcomes).toEqual([
      { area: "business_model", status: "blocked", reason: expect.stringContaining("homepage") },
      { area: "decisions", status: "blocked", reason: expect.stringContaining("homepage") },
      { area: "hiring", status: "blocked", reason: expect.stringContaining("homepage") },
    ]);
  });
});
