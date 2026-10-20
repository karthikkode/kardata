import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { feedsCollector } from "../../src/collect/collectors/feeds.js";
import { reviewsCollector } from "../../src/collect/collectors/reviews.js";
import { siteCollector } from "../../src/collect/collectors/site.js";
import { stackCollector } from "../../src/collect/collectors/stack.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import {
  collectorCtx,
  docsForRun,
  factsForRun,
  recordsForRun,
  restoreHostDelay,
  seedApolloImportSource,
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

const recent = new Date();
recent.setDate(recent.getDate() - 10);

function seedStandardSite(): void {
  site.routes.set(
    "/",
    (_req, res) =>
      sendText(
        res,
        `<html><head><title>Fake Skin Co</title>
<link rel="alternate" type="application/rss+xml" href="/feed.xml" />
<script type="application/ld+json">{"@type":"Product","name":"Serum","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"120"}}</script>
</head><body>
<a href="/about">About</a>
<script src="https://cdn.judge.me/shopify_v2.js"></script>
<script src="https://cdn.klaviyo.com/onsite/js/klaviyo.js"></script>
</body></html>`,
      ),
  );
  site.routes.set(
    "/sitemap.xml",
    (_req, res) =>
      sendText(
        res,
        `<?xml version="1.0"?><urlset>` +
          `<url><loc>${site.baseUrl}/about</loc></url>` +
          `<url><loc>${site.baseUrl}/products/serum</loc></url>` +
          `<url><loc>${site.baseUrl}/products/cleanser</loc></url>` +
          `</urlset>`,
        200,
        "application/xml",
      ),
  );
  site.routes.set("/about", (_req, res) => sendText(res, "<html><head><title>About</title></head></html>"));
  site.routes.set(
    "/products/serum",
    (_req, res) =>
      sendText(
        res,
        `<html><head><title>Serum</title><script type="application/ld+json">{"@type":"Product","aggregateRating":{"ratingValue":"4.9","reviewCount":"45"}}</script></head><body></body></html>`,
      ),
  );
  site.routes.set(
    "/products/cleanser",
    (_req, res) => sendText(res, "<html><head><title>Cleanser</title></head><body></body></html>"),
  );
  site.routes.set(
    "/feed.xml",
    (_req, res) =>
      sendText(
        res,
        `<?xml version="1.0"?><rss><channel>` +
          `<item><title>New launch</title><link>${site.baseUrl}/blog/launch</link><pubDate>${recent.toUTCString()}</pubDate></item>` +
          `<item><title>Old news</title><link>${site.baseUrl}/blog/old</link><pubDate>Mon, 01 Jan 2020 00:00:00 GMT</pubDate></item>` +
          `</channel></rss>`,
        200,
        "application/rss+xml",
      ),
  );
}

describe("reviews collector", () => {
  it("aggregates homepage and product ratings and detects the review app", async () => {
    seedStandardSite();
    const companyId = await seedCompany(handle.db, { website: site.baseUrl });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    await siteCollector.run(ctx);
    const result = await reviewsCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "reviews", status: "done" }]);

    const docs = (await docsForRun(handle.db, runId)).filter((d) => d.createdBy === "collector:reviews");
    expect(docs).toHaveLength(1);
    expect(docs[0]?.contentMd).toContain("4.8 from 120 reviews");
    expect(docs[0]?.contentMd).toContain("4.9 from 45 reviews");
    expect(docs[0]?.contentMd).toContain("Judge.me");
    expect(docs[0]?.sourceIds).toHaveLength(3);

    const factRows = await factsForRun(handle.db, runId);
    const ratings = factRows.filter((f) => f.key === "reviews.avg_rating");
    expect(ratings.map((f) => f.valueNum).sort()).toEqual(["4.8", "4.9"]);
    expect(ratings.every((f) => (f.qualifiers as Record<string, string>)["platform"] === "Judge.me")).toBe(true);
    expect(factRows.filter((f) => f.key === "reviews.count")).toHaveLength(2);
    expect(factRows.find((f) => f.key === "reviews.app")?.valueText).toBe("Judge.me");
    expect(await recordsForRun(handle.db, runId)).toHaveLength(0);
  });

  it("reports not_found when there are no ratings or apps", async () => {
    site.routes.set("/", (_req, res) =>
      sendText(res, "<html><head><title>Plain</title></head><body>Hi</body></html>"),
    );
    const companyId = await seedCompany(handle.db, { website: site.baseUrl });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    await siteCollector.run(ctx);
    const result = await reviewsCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "reviews", status: "not_found", reason: "no ratings or review app detected" },
    ]);
  });
});

describe("stack collector", () => {
  it("maps Apollo tech plus homepage scripts to marketing and business-model signals", async () => {
    seedStandardSite();
    const companyId = await seedCompany(handle.db, {
      website: site.baseUrl,
      technologies: ["Shopify", "ReCharge", "Afterpay", "Gorgias"],
    });
    const apolloSourceId = await seedApolloImportSource(handle.db, companyId);
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    await siteCollector.run(ctx);
    const homepageId = ctx.shared.site?.homepage?.sourceId;
    expect(homepageId).toBeDefined();
    const result = await stackCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "marketing", status: "done" },
      { area: "business_model", status: "done" },
    ]);

    const docs = (await docsForRun(handle.db, runId)).filter((d) => d.createdBy === "collector:stack");
    expect(docs).toHaveLength(2);
    const marketing = docs.find((d) => d.area === "marketing")?.contentMd ?? "";
    const bm = docs.find((d) => d.area === "business_model")?.contentMd ?? "";
    expect(marketing).toContain("Email / SMS: Klaviyo");
    expect(marketing).toContain("Ad pixels: none detected");
    expect(bm).toContain("Subscriptions: ReCharge");
    expect(bm).toContain("Buy now, pay later: Afterpay");
    expect(bm).toContain("Support: Gorgias");

    const factRows = await factsForRun(handle.db, runId);
    const channels = factRows
      .filter((f) => f.key === "marketing.channel_active")
      .map((f) => (f.qualifiers as Record<string, string>)["channel"])
      .sort();
    expect(channels).toEqual(["email", "sms"]);
    expect(factRows.every((f) => f.createdBy === "collector:stack")).toBe(true);
    const tools = factRows.filter((f) => f.key === "marketing.tool");
    expect(tools.map((f) => f.valueText).sort()).toEqual(["Afterpay", "Gorgias", "Klaviyo", "ReCharge"]);
    expect(factRows.find((f) => f.key === "business_model.subscription")?.valueBool).toBe(true);
    expect(factRows.find((f) => f.key === "business_model.bnpl")?.valueBool).toBe(true);
    expect(factRows.find((f) => f.key === "business_model.wholesale")).toBeUndefined();
    // Provenance: Apollo-technology detections cite the import source,
    // script detections cite the homepage.
    const sourcesOf = (key: string, match: (f: (typeof factRows)[number]) => boolean) =>
      factRows.filter((f) => f.key === key && match(f)).flatMap((f) => f.sourceIds);
    const klaviyo = sourcesOf("marketing.tool", (f) => f.valueText === "Klaviyo");
    expect(klaviyo).toEqual([homepageId]);
    for (const tool of ["ReCharge", "Afterpay", "Gorgias"]) {
      expect(sourcesOf("marketing.tool", (f) => f.valueText === tool)).toEqual([apolloSourceId]);
    }
    expect(factRows.find((f) => f.key === "business_model.subscription")?.sourceIds).toEqual([
      apolloSourceId,
    ]);
  });

  it("cites the import source for Apollo-technology facts when the homepage fetch failed", async () => {
    const companyId = await seedCompany(handle.db, {
      website: "https://dead.invalid",
      technologies: ["Klaviyo", "ReCharge", "Yotpo Loyalty"],
    });
    const apolloSourceId = await seedApolloImportSource(handle.db, companyId);
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    // No site run: the homepage fetch failed, so every signal is Apollo-only.
    const result = await stackCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "marketing", status: "done" },
      { area: "business_model", status: "done" },
    ]);
    const factRows = await factsForRun(handle.db, runId);
    expect(factRows.length).toBeGreaterThan(0);
    expect(factRows.every((f) => f.sourceIds.length === 1 && f.sourceIds[0] === apolloSourceId)).toBe(true);
    const tools = factRows
      .filter((f) => f.key === "marketing.tool")
      .map((f) => f.valueText)
      .sort();
    expect(tools).toEqual(["Klaviyo", "ReCharge", "Yotpo Loyalty"]);
    const channels = factRows
      .filter((f) => f.key === "marketing.channel_active")
      .map((f) => (f.qualifiers as Record<string, string>)["channel"])
      .sort();
    expect(channels).toEqual(["email", "loyalty", "sms"]);
    expect(factRows.find((f) => f.key === "business_model.subscription")?.valueBool).toBe(true);
  });

  it("reports not_found per area when nothing matches", async () => {
    seedStandardSite();
    const companyId = await seedCompany(handle.db, { website: site.baseUrl, technologies: ["Nginx"] });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    // Skip the site run: no homepage scripts, tech-only signals.
    const result = await stackCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "marketing", status: "not_found", reason: "no marketing tools detected" },
      { area: "business_model", status: "not_found", reason: "no business-model tools detected" },
    ]);
  });
});

describe("feeds collector", () => {
  it("lists dated post titles from the last 24 months", async () => {
    seedStandardSite();
    const companyId = await seedCompany(handle.db, { website: site.baseUrl });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    await siteCollector.run(ctx);
    const result = await feedsCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "decisions", status: "done" }]);

    const docs = (await docsForRun(handle.db, runId)).filter((d) => d.createdBy === "collector:feeds");
    expect(docs).toHaveLength(1);
    expect(docs[0]?.contentMd).toContain("New launch");
    expect(docs[0]?.contentMd).not.toContain("Old news");

    const recordRows = await recordsForRun(handle.db, runId);
    expect(recordRows).toHaveLength(1);
    expect(recordRows[0]?.type).toBe("blog_post");
    expect(recordRows[0]?.data).toMatchObject({ title: "New launch", url: `${site.baseUrl}/blog/launch` });
    expect(await factsForRun(handle.db, runId)).toHaveLength(0);
  });

  it("reports not_found when no feeds exist", async () => {
    site.routes.set("/", (_req, res) =>
      sendText(res, "<html><head><title>Plain</title></head><body>Hi</body></html>"),
    );
    const companyId = await seedCompany(handle.db, { website: site.baseUrl });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    await siteCollector.run(ctx);
    const result = await feedsCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "decisions", status: "not_found", reason: "no feeds found" },
    ]);
  });
});
