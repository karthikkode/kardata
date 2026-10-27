import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, companyJobs, sectorCompanies, sectorPreflight, sectors } from "../../src/db/schema.js";
import { createSector } from "../../src/domain/sectors.js";
import {
  applySectorScope,
  setRubric,
} from "../../src/domain/sector-preflight/eligibility.js";
import { parseSectorProfile, profileHash } from "../../src/domain/sector-preflight/profile.js";
import { classifyCompany, createSectorRun } from "../../src/runs/sector-classify.js";
import { startPipeline } from "../../src/runs/sector.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const FIXTURES = resolve("tests/fixtures");
const USAGE = { inputTokens: 100, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0, calls: 1 };

const GARDEN_PROFILE = {
  name: "garden",
  description: "Garden and outdoor living D2C brands (synthetic test sector)",
  categories: [
    { key: "growing", label: "Growing", description: "Seeds, bulbs, plants, compost and soil care." },
    { key: "tools_watering", label: "Tools & watering", description: "Hand tools, power tools, hoses, irrigation and watering systems." },
    { key: "outdoor_decor", label: "Outdoor decor", description: "Garden decor, furniture, lighting and structures." },
  ],
  scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [] },
  rubric: {
    eligible: {
      businessTypes: ["dtc_brand"],
      primaryCategories: ["growing"],
      requireSellsOwnProducts: true,
      requireHasOnlineStore: true,
    },
    review: { businessTypes: ["brand_retail_only", "unknown"], primaryCategories: [], lowConfidence: true },
  },
  classifierHints: {
    serviceExamples: "landscaping or garden-design service without its own product line",
    retailerExamples: "garden centre or DIY chain selling other brands",
    supplierExamples: "grower or materials supplier selling only to trade",
  },
};

const ANSWERS: Record<string, Record<string, unknown>> = {
  "Seedling & Sprout Co": {
    business_type: "dtc_brand", primary_category: "growing", also_sells: [],
    sells_own_products: true, has_online_store: true, confidence: "high",
    reason: "sells own-brand seeds direct", quote: "we sell seeds", quote_source_id: null, ships_to: ["US"],
  },
  "Timber & Trowel": {
    business_type: "dtc_brand", primary_category: "tools_watering", also_sells: [],
    sells_own_products: true, has_online_store: true, confidence: "high",
    reason: "own-brand tools", quote: "we sell seeds", quote_source_id: null, ships_to: ["US"],
  },
  "Greenburgh Garden Centre": {
    business_type: "retailer_marketplace", primary_category: "growing", also_sells: [],
    sells_own_products: false, has_online_store: true, confidence: "high",
    reason: "garden centre chain", quote: "we sell seeds", quote_source_id: null, ships_to: ["US"],
  },
  "Verdant Yards Ltd": {
    business_type: "agency_service", primary_category: "other", also_sells: [],
    sells_own_products: false, has_online_store: false, confidence: "high",
    reason: "landscaping service", quote: "we sell seeds", quote_source_id: null, ships_to: ["US"],
  },
};

let handle: DbHandle;
let server: Server;
let origin: string;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><head><title>t</title></head><body>we sell seeds and garden goods</body></html>");
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

describe("garden sector end to end (synthetic)", () => {
  it("imports, classifies, scopes and pipelines from its own profile", async () => {
    const { sector } = await createSector(
      handle.db,
      {
        name: "Garden Test",
        csvPaths: [resolve(FIXTURES, "apollo-garden.csv")],
        profile: GARDEN_PROFILE,
      },
      { importDirs: [FIXTURES] },
    );
    await setRubric(handle.db, sector.id, GARDEN_PROFILE.rubric);

    const members = await handle.db
      .select()
      .from(sectorCompanies)
      .where(eq(sectorCompanies.sectorId, sector.id));
    expect(members).toHaveLength(4);

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
          const answer = Object.entries(ANSWERS).find(([name]) => prompt.includes(name))?.[1];
          if (!answer) throw new Error("no fake answer for prompt");
          return { json: answer, raw: JSON.stringify(answer), usage: USAGE };
        },
      });
    }

    expect(prompts[0]).toContain("growing");
    expect(prompts[0]).toContain("landscaping or garden-design service");
    expect(prompts[0]).not.toContain("skincare");

    const rows = await handle.db
      .select()
      .from(sectorPreflight)
      .where(eq(sectorPreflight.sectorId, sector.id));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.promptVersion).toBe("v2");
      expect(row.profileHash).toBe(profileHash(parseSectorProfile(GARDEN_PROFILE)));
    }

    const applied = await applySectorScope(handle.db, sector.id);
    expect(applied).toEqual({ eligible: 1, ineligible: 3, skippedOverride: 0, skippedPending: 0 });

    const membership = await handle.db
      .select()
      .from(sectorCompanies)
      .where(eq(sectorCompanies.sectorId, sector.id));
    const byCompany = new Map(membership.map((m) => [m.companyId, m]));
    const seedling = await handle.db
      .select()
      .from(companies)
      .where(eq(companies.name, "Seedling & Sprout Co"));
    expect(byCompany.get(seedling[0]!.id)?.eligibility).toBe("eligible");

    const job = await startPipeline(handle.db, sector.id, { categories: ["growing"] });
    expect(job).toBeTruthy();
    const jobItems = await handle.db.select().from(companyJobs);
    expect(jobItems).toHaveLength(1);
    expect(jobItems[0]?.companyId).toBe(seedling[0]!.id);

    const [sectorRow] = await handle.db.select().from(sectors).where(eq(sectors.id, sector.id));
    expect(sectorRow?.profile).toBeTruthy();
    void randomUUID;
  });
});
