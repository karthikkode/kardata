import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  companies,
  providerCalls,
  researchRuns,
  sectors,
  sectorPreflight,
  sources,
} from "../../src/db/schema.js";
import {
  classifyCompany,
  type ClassifierCall,
} from "../../src/runs/sector-classify.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { restoreHostDelay, shrinkHostDelay } from "../collect/helpers.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;

const USAGE = { model: "test", inputTokens: 100, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0, calls: 1 };
const ALLOW = { privateHostAllowlist: ["127.0.0.1"] };

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
  site = await startFakeSite();
});

beforeEach(async () => {
  await resetTestDb(handle);
  site.routes.clear();
});

afterAll(async () => {
  await site.close();
  restoreHostDelay(delayPrev);
  await handle.close();
});

async function makeSector(name: string): Promise<string> {
  const [row] = await handle.db
    .insert(sectors)
    .values({ id: randomUUID(), name })
    .returning({ id: sectors.id });
  if (!row) throw new Error("no sector row");
  return row.id;
}

async function makeCompany(name: string, website: string | null): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name, website, industry: "Beauty", keywords: ["serum"], employees: 11, country: "Australia" })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function rowFor(sectorId: string, companyId: string) {
  const [row] = await handle.db
    .select()
    .from(sectorPreflight)
    .where(and(eq(sectorPreflight.sectorId, sectorId), eq(sectorPreflight.companyId, companyId)));
  return row;
}

function homePage(): string {
  return `<html><body><h1>Acme Skin</h1><p>buy our serum online today with free shipping</p><a href="/about">About</a><a href="/shop">Shop all</a></body></html>`;
}

describe("classifyCompany", () => {
  it("fetches pages, classifies, grounds the quote, and logs the call", async () => {
    site.routes.set("/", (_req, res) => sendText(res, homePage()));
    site.routes.set("/about", (_req, res) => sendText(res, "<html><body>Our story since 2019</body></html>"));
    site.routes.set("/shop", (_req, res) => sendText(res, "<html><body>Shop all serums</body></html>"));
    site.routes.set("/products.json", (_req, res, url) => sendJson(res, { products: url.searchParams.has("limit") ? [{ title: "Serum" }] : [] }));
    const sectorId = await makeSector("Skincare");
    const companyId = await makeCompany("Acme", site.baseUrl);
    const prompts: string[] = [];
    const call: ClassifierCall = async ({ runId, prompt }) => {
      prompts.push(prompt);
      const rows = await handle.db.select().from(sources).where(eq(sources.runId, runId));
      const cited = rows.find((r) => r.url === site.baseUrl || r.url === `${site.baseUrl}/`);
      if (!cited) throw new Error("no homepage source to cite");
      return {
        json: {
          business_type: "dtc_brand",
          primary_category: "skincare",
          sells_own_products: true,
          has_online_store: true,
          ships_to: ["Australia"],
          confidence: "high",
          reason: "Own-brand serum sold through an on-site cart.",
          quote: "buy our serum online today",
          quote_source_id: cited.id,
        },
        usage: USAGE,
        raw: "{}",
      };
    };

    const outcome = await classifyCompany(handle.db, { sectorId, companyId, call, fetchOptions: ALLOW });

    expect(outcome.verification).toBe("verified");
    expect(outcome.apolloOnly).toBe(false);
    // Homepage + about + shop fetched (products.json is the extra probe).
    expect(site.hits.filter((h) => h.path === "/about")).toHaveLength(1);
    expect(site.hits.filter((h) => h.path === "/shop")).toHaveLength(1);
    expect(site.hits.filter((h) => h.path === "/products.json")).toHaveLength(1);
    expect(prompts[0]).toContain("industry: Beauty");
    expect(prompts[0]).toContain("Our story since 2019");
    const stored = await rowFor(sectorId, companyId);
    expect(stored?.businessType).toBe("dtc_brand");
    expect(stored?.verification).toBe("verified");
    expect(stored?.runId).toBe(outcome.runId);
    const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, outcome.runId));
    expect(run?.status).toBe("succeeded");
    expect(run?.kind).toBe("sector_preflight");
    const logged = await handle.db.select().from(providerCalls).where(eq(providerCalls.runId, outcome.runId));
    expect(logged).toHaveLength(1);
    expect(logged[0]?.stage).toBe("sector_preflight");
    expect(logged[0]?.inputTokens).toBe(100);
  });

  it("marks quote_mismatch when the quote is not in the cited source", async () => {
    site.routes.set("/", (_req, res) => sendText(res, homePage()));
    const sectorId = await makeSector("Skincare");
    const companyId = await makeCompany("Acme", site.baseUrl);
    const call: ClassifierCall = async ({ runId }) => {
      const rows = await handle.db.select().from(sources).where(eq(sources.runId, runId));
      const cited = rows.find((r) => r.status === "ok");
      if (!cited) throw new Error("no source to cite");
      return {
        json: {
          business_type: "dtc_brand",
          primary_category: "skincare",
          sells_own_products: true,
          has_online_store: true,
          ships_to: [],
          confidence: "medium",
          reason: "Made-up quote.",
          quote: "we sell submarines and rockets",
          quote_source_id: cited.id,
        },
        usage: USAGE,
      };
    };
    const outcome = await classifyCompany(handle.db, { sectorId, companyId, call, fetchOptions: ALLOW });
    expect(outcome.verification).toBe("quote_mismatch");
    expect((await rowFor(sectorId, companyId))?.verification).toBe("quote_mismatch");
  });

  it("falls back to Apollo-only on a blocked homepage and requires low confidence", async () => {
    // 403, not robots: the fetcher caches robots.txt per fake-site host across tests.
    site.routes.set("/", (_req, res) => sendText(res, "denied", 403));
    const sectorId = await makeSector("Skincare");
    const companyId = await makeCompany("Blocked Co", site.baseUrl);
    const apolloCall: ClassifierCall = async () => ({
      json: {
        business_type: "unknown",
        primary_category: "other",
        sells_own_products: false,
        has_online_store: false,
        ships_to: [],
        confidence: "low",
        reason: "Site blocked; Apollo record only.",
        quote: null,
        quote_source_id: null,
      },
      usage: USAGE,
    });
    const hitsBefore = site.hits.length;
    const outcome = await classifyCompany(handle.db, { sectorId, companyId, call: apolloCall, fetchOptions: ALLOW });
    expect(outcome.apolloOnly).toBe(true);
    expect(outcome.verification).toBe("unverified");
    // Blocked homepage: no subpages and no Shopify probe were attempted.
    const paths = site.hits.slice(hitsBefore).map((h) => h.path);
    expect(paths.every((p) => p === "/" || p === "/robots.txt")).toBe(true);

    const badCall: ClassifierCall = async () => ({
      json: {
        business_type: "dtc_brand",
        primary_category: "skincare",
        sells_own_products: true,
        has_online_store: true,
        ships_to: [],
        confidence: "medium",
        reason: "Overconfident on Apollo only.",
        quote: null,
        quote_source_id: null,
      },
      usage: USAGE,
    });
    await expect(classifyCompany(handle.db, { sectorId, companyId, call: badCall, fetchOptions: ALLOW })).rejects.toThrow(
      /low confidence/,
    );
  });

  it("reclassifying upserts the latest classification", async () => {
    site.routes.set("/", (_req, res) => sendText(res, homePage()));
    const sectorId = await makeSector("Skincare");
    const companyId = await makeCompany("Acme", null);
    const callFor = (businessType: string): ClassifierCall => async () => ({
      json: {
        business_type: businessType,
        primary_category: "skincare",
        sells_own_products: true,
        has_online_store: true,
        ships_to: [],
        confidence: "low",
        reason: "Apollo only.",
        quote: null,
        quote_source_id: null,
      },
      usage: USAGE,
    });
    await classifyCompany(handle.db, { sectorId, companyId, call: callFor("unknown") });
    await classifyCompany(handle.db, { sectorId, companyId, call: callFor("dtc_brand") });
    const rows = await handle.db
      .select()
      .from(sectorPreflight)
      .where(and(eq(sectorPreflight.sectorId, sectorId), eq(sectorPreflight.companyId, companyId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.businessType).toBe("dtc_brand");
  });

  it("fails the run on an invalid classification", async () => {
    site.routes.set("/", (_req, res) => sendText(res, homePage()));
    const sectorId = await makeSector("Skincare");
    const companyId = await makeCompany("Acme", site.baseUrl);
    const call: ClassifierCall = async () => ({ json: { business_type: "cult" }, usage: USAGE });
    await expect(classifyCompany(handle.db, { sectorId, companyId, call, fetchOptions: ALLOW })).rejects.toThrow(
      /invalid classification/,
    );
    const runs = await handle.db.select().from(researchRuns).where(eq(researchRuns.companyId, companyId));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("failed");
    expect(await rowFor(sectorId, companyId)).toBeUndefined();
  });
});
