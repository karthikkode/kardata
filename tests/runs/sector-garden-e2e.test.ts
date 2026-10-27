import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, companyJobs, sectorCompanies, sectorPreflight, sectors } from "../../src/db/schema.js";
import { createSector } from "../../src/domain/sectors.js";
import { rederiveSectorScope } from "../../src/domain/sector-preflight/eligibility.js";
import { parseSectorProfile, profileHash } from "../../src/domain/sector-preflight/profile.js";
import { classifyCompany, createSectorRun } from "../../src/runs/sector-classify.js";
import { startPipeline } from "../../src/runs/sector.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const FIXTURES = resolve("tests/fixtures");
/** Enough readable text that fake homepages are not thin pages. */
const GARDEN_STORY =
  "Our nursery grows vegetable seeds, flower bulbs and herbs on a family farm and ships them across the country. " +
  "Every packet carries sowing notes, and our growers answer questions by email. Shop raised beds, planters and " +
  "watering cans, join the seed club for seasonal boxes, and read the planting calendar before you sow this spring. " +
  "Orders over forty dollars ship free, and every order includes a bonus packet of wildflower seeds for bees.";
const USAGE = { inputTokens: 100, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0, calls: 1 };

// Synthetic test profile: kept in this test file only. The owner's real
// garden profile is docs/plans/stage-5.4-garden-profile.json, asserted by
// tests/unit/sector-garden-profile-file.test.ts.
const TEST_PROFILE = {
  name: "garden-test",
  description: "Synthetic test profile for the garden e2e fixture",
  categories: [
    { key: "growing", label: "Growing", description: "Seeds, bulbs, plants, compost and soil care." },
    { key: "tools_watering", label: "Tools & watering", description: "Hand tools, power tools, hoses, irrigation." },
    { key: "planters_structures", label: "Planters & structures", description: "Pots, planters, raised beds, greenhouses." },
    { key: "outdoor_furniture", label: "Outdoor furniture", description: "Garden furniture, parasols, pergolas." },
    { key: "lighting_decor", label: "Lighting & decor", description: "Garden lighting, ornaments, giftware." },
    { key: "lawn_care", label: "Lawn care", description: "Lawn feed and seed, mowers, smart lawn devices." },
  ],
  scope: {
    coreCategories: ["growing", "tools_watering", "planters_structures", "outdoor_furniture", "lighting_decor", "lawn_care"],
    adjacentCategories: [],
    scopeKeywords: [],
    businessTypes: ["dtc_brand"],
    requireSellsOwnProducts: true,
    requireHasOnlineStore: true,
  },
  tiering: { apolloMinPerStaff: 75000, staffEstimatePerHead: 175000, publicCheckPerStaff: 1000000, pressSources: [] },
  promptHints: { retailerExamples: "example retailers", priceTiers: "example tiers", productClaims: "example claims", positioningStory: "example story" },
  classifierHints: {
    serviceExamples: "landscaping or garden-design service without its own product line",
    retailerExamples: "garden centre or DIY chain selling other brands",
    supplierExamples: "grower or materials supplier selling only to trade",
  },
};

function answer(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    also_sells: [], sells_own_products: true, has_online_store: true, confidence: "high",
    reason: "synthetic fixture", quote: "we sell seeds", quote_source_id: null, ships_to: ["US"],
    ...patch,
  };
}

const ANSWERS: Record<string, Record<string, unknown>> = {
  "Seedling & Sprout Co": answer({ business_type: "dtc_brand", primary_category: "growing" }),
  "Timber & Trowel": answer({ business_type: "dtc_brand", primary_category: "tools_watering" }),
  "Raised & Rooted": answer({ business_type: "dtc_brand", primary_category: "planters_structures" }),
  "Pergola & Porch": answer({ business_type: "dtc_brand", primary_category: "outdoor_furniture" }),
  "Lantern Hollow": answer({ business_type: "dtc_brand", primary_category: "lighting_decor" }),
  "Meadow Mow Co": answer({ business_type: "dtc_brand", primary_category: "lawn_care" }),
  "Greenburgh Garden Centre": answer({
    business_type: "retailer_marketplace", primary_category: "growing", sells_own_products: false,
  }),
  "Outdoor Emporium": answer({
    business_type: "retailer_marketplace", primary_category: "outdoor_furniture", sells_own_products: false,
  }),
  "Verdant Yards Ltd": answer({
    business_type: "agency_service", primary_category: "other", sells_own_products: false, has_online_store: false,
  }),
  "Harvest Lane": answer({
    business_type: "brand_retail_only", primary_category: "growing", has_online_store: false,
  }),
  "Dormant Plots Ltd": answer({
    business_type: "site_dead_or_parked", primary_category: "other", sells_own_products: false, has_online_store: false,
  }),
  "Fable Fern Co": answer({ business_type: "dtc_brand", primary_category: "growing", confidence: "low" }),
};

// Binary scope has no "review": the low-confidence D2C brand is in scope
// (core category), the retail-only brand is out (not an in-scope type).
const EXPECTED_SCOPE: Record<string, "eligible" | "ineligible"> = {
  "Seedling & Sprout Co": "eligible",
  "Timber & Trowel": "eligible",
  "Raised & Rooted": "eligible",
  "Pergola & Porch": "eligible",
  "Lantern Hollow": "eligible",
  "Meadow Mow Co": "eligible",
  "Greenburgh Garden Centre": "ineligible",
  "Outdoor Emporium": "ineligible",
  "Verdant Yards Ltd": "ineligible",
  "Harvest Lane": "ineligible",
  "Dormant Plots Ltd": "ineligible",
  "Fable Fern Co": "eligible",
};

let handle: DbHandle;
let server: Server;
let origin: string;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><head><title>t</title></head><body>we sell seeds and garden goods. ${GARDEN_STORY} ${GARDEN_STORY}</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

beforeEach(async () => {
  await resetTestDb(handle);
});

afterAll(async () => {
  server.close();
  await handle.close();
});

async function eligibilityByName(sectorId: string): Promise<Record<string, string | null>> {
  const members = await handle.db
    .select({ eligibility: sectorCompanies.eligibility, name: companies.name })
    .from(sectorCompanies)
    .innerJoin(companies, eq(companies.id, sectorCompanies.companyId))
    .where(eq(sectorCompanies.sectorId, sectorId));
  return Object.fromEntries(members.map((m) => [m.name, m.eligibility]));
}

describe("garden sector end to end (synthetic)", () => {
  it("imports, classifies, scopes and pipelines from its own profile", async () => {
    const { sector } = await createSector(
      handle.db,
      {
        name: "Garden Test",
        csvPaths: [resolve(FIXTURES, "apollo-garden.csv")],
        profile: TEST_PROFILE,
      },
      { importDirs: [FIXTURES] },
    );
    const members = await handle.db
      .select()
      .from(sectorCompanies)
      .where(eq(sectorCompanies.sectorId, sector.id));
    expect(members).toHaveLength(12);

    const prompts: string[] = [];
    for (const member of members) {
      const [company] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, member.companyId));
      if (!company) throw new Error("company gone");
      await handle.db
        .update(companies)
        .set({ website: origin })
        .where(eq(companies.id, company.id));
      const runId = await createSectorRun(handle.db, company.id);
      await classifyCompany(handle.db, {
        sectorId: sector.id,
        companyId: company.id,
        runId,
        fetchOptions: { privateHostAllowlist: ["127.0.0.1"] },
        call: async ({ prompt }) => {
          prompts.push(prompt);
          const found = Object.entries(ANSWERS).find(([name]) => prompt.includes(name))?.[1];
          if (!found) throw new Error("no fake answer for prompt");
          return { json: found, raw: JSON.stringify(found), usage: USAGE };
        },
      });
    }

    const joined = prompts.join("\n");
    expect(joined).toContain("planters_structures");
    expect(joined).toContain("landscaping or garden-design service");
    expect(joined).not.toContain("skincare");

    const rows = await handle.db
      .select()
      .from(sectorPreflight)
      .where(eq(sectorPreflight.sectorId, sector.id));
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.promptVersion).toBe("v2");
      expect(row.profileHash).toBe(profileHash(parseSectorProfile(TEST_PROFILE)));
    }

    const applied = await rederiveSectorScope(handle.db, sector.id);
    expect(applied).toEqual({ eligible: 7, ineligible: 5, skippedOverride: 0, skippedPending: 0 });
    expect(await eligibilityByName(sector.id)).toEqual(EXPECTED_SCOPE);

    const job = await startPipeline(handle.db, sector.id, { categories: ["growing"] });
    expect(job).toBeTruthy();
    const jobItems = await handle.db
      .select({ name: companies.name })
      .from(companyJobs)
      .innerJoin(companies, eq(companies.id, companyJobs.companyId));
    expect(jobItems.map((j) => j.name).sort()).toEqual(["Fable Fern Co", "Seedling & Sprout Co"]);

    const [sectorRow] = await handle.db.select().from(sectors).where(eq(sectors.id, sector.id));
    expect(sectorRow?.profile).toBeTruthy();
  }, 180000);
});
