import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { eq } from "drizzle-orm";
import { companies, sectorCompanies, sectorPreflight, sectors } from "../../src/db/schema.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  categoryKeys,
  getProfile,
  getProfileOrNull,
  parseSectorProfile,
  setProfile,
} from "../../src/domain/sector-preflight/profile.js";

const TEST_PROFILE = parseSectorProfile(
  JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
);
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

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

async function makeSector(name: string): Promise<string> {
  const [row] = await handle.db
    .insert(sectors)
    .values({ id: randomUUID(), name })
    .returning({ id: sectors.id });
  if (!row) throw new Error("no sector row");
  return row.id;
}

describe("sector profile storage", () => {
  it("round-trips a stored profile and refuses a sector without one", async () => {
    const sectorId = await makeSector("garden-test");
    await expect(getProfile(handle.db, sectorId)).rejects.toThrowError(/has no profile/);
    expect(await getProfileOrNull(handle.db, sectorId)).toBeNull();
    const result = await setProfile(handle.db, sectorId, {
      categories: [
        { key: "growing", label: "Growing", description: "Seeds and plants." },
        { key: "tools_watering", label: "Tools", description: "Tools and watering." },
      ],
      scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [], businessTypes: ["dtc_brand"], requireSellsOwnProducts: true, requireHasOnlineStore: true },
  tiering: { apolloMinPerStaff: 75000, staffEstimatePerHead: 175000, publicCheckPerStaff: 1000000, pressSources: [] },
  promptHints: { retailerExamples: "example retailers", priceTiers: "example tiers", productClaims: "example claims", positioningStory: "example story" },
      classifierHints: {
        serviceExamples: "landscaping",
        retailerExamples: "garden centres",
        supplierExamples: "trade growers",
      },
    });
    expect(categoryKeys(result.profile)).toEqual(["growing", "tools_watering", "other"]);
    const stored = await getProfile(handle.db, sectorId);
    expect(stored).toEqual(result.profile);
  });

  it("refuses a category change after classifications, reclassify marks them pending", async () => {
    const sectorId = await makeSector("skincare-refusal");
    await setProfile(handle.db, sectorId, TEST_PROFILE);
    const [company] = await handle.db
      .insert(companies)
      .values({ id: randomUUID(), source: "manual", name: "Synthetic Brand" })
      .returning({ id: companies.id });
    if (!company) throw new Error("no company");
    await handle.db
      .insert(sectorCompanies)
      .values({ sectorId, companyId: company.id, addedVia: "manual", eligibility: "eligible" });
    await handle.db.insert(sectorPreflight).values({
      id: randomUUID(),
      sectorId,
      companyId: company.id,
      businessType: "dtc_brand",
      primaryCategory: "widgets",
      sellsOwnProducts: true,
      hasOnlineStore: true,
      shipsTo: [],
      confidence: "high",
      reason: "synthetic",
    });
    const renamed = {
      ...TEST_PROFILE,
      categories: TEST_PROFILE.categories.map((c) =>
        c.key === "widgets" ? { ...c, key: "super_widgets" } : c,
      ),
      scope: {
        ...TEST_PROFILE.scope,
        coreCategories: ["super_widgets"],
      },
    };
    await expect(setProfile(handle.db, sectorId, renamed)).rejects.toThrowError(/reclassify: true/);
    const result = await setProfile(handle.db, sectorId, renamed, { reclassify: true });
    expect(result.reclassifyPending).toBe(1);
    const [membership] = await handle.db
      .select()
      .from(sectorCompanies)
      .where(eq(sectorCompanies.companyId, company.id));
    expect(membership?.eligibility).toBe("pending");
  });

  it("rejects a profile carrying the removed rubric field and stores nothing", async () => {
    const sectorId = await makeSector("garden-test");
    await expect(
      setProfile(handle.db, sectorId, {
        categories: [{ key: "growing", label: "Growing", description: "Seeds and plants." }],
        scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [], businessTypes: ["dtc_brand"], requireSellsOwnProducts: true, requireHasOnlineStore: true },
  tiering: { apolloMinPerStaff: 75000, staffEstimatePerHead: 175000, publicCheckPerStaff: 1000000, pressSources: [] },
  promptHints: { retailerExamples: "example retailers", priceTiers: "example tiers", productClaims: "example claims", positioningStory: "example story" },
        classifierHints: {
          serviceExamples: "landscaping",
          retailerExamples: "garden centres",
          supplierExamples: "trade growers",
        },
        rubric: { eligible: {}, review: {} },
      }),
    ).rejects.toThrow(/invalid sector profile/);
    expect(await getProfileOrNull(handle.db, sectorId)).toBeNull();
  });

  it("sector_create with a profile stores it; changed fields are reported on update", async () => {
    const profile = {
      categories: [{ key: "growing", label: "Growing", description: "Seeds and plants." }],
      scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [], businessTypes: ["dtc_brand"], requireSellsOwnProducts: true, requireHasOnlineStore: true },
  tiering: { apolloMinPerStaff: 75000, staffEstimatePerHead: 175000, publicCheckPerStaff: 1000000, pressSources: [] },
  promptHints: { retailerExamples: "example retailers", priceTiers: "example tiers", productClaims: "example claims", positioningStory: "example story" },
      classifierHints: {
        serviceExamples: "landscaping",
        retailerExamples: "garden centres",
        supplierExamples: "trade growers",
      },
    };
    const { sector } = await createSector(handle.db, { name: "garden-created", profile });
    const stored = await getProfile(handle.db, sector.id);
    expect(categoryKeys(stored)).toEqual(["growing", "other"]);
    const updated = await setProfile(handle.db, sector.id, {
      ...profile,
      promptHints: { ...profile.promptHints, priceTiers: "new tiers" },
    });
    expect(updated.changedFields).toContain("promptHints");
    expect(updated.before).toEqual(updated.after);
  });

  it("stores the fixture profile with its scope intact", async () => {
    const sectorId = await makeSector("sample-sector");
    const result = await setProfile(handle.db, sectorId, TEST_PROFILE);
    expect(categoryKeys(result.profile)).toEqual(["widgets", "gadgets", "other"]);
    expect(result.profile.scope.coreCategories).toEqual(["widgets"]);
    expect(result.profile.scope.adjacentCategories).toEqual(["gadgets"]);
    const [membership] = await handle.db
      .select()
      .from(sectorCompanies)
      .where(eq(sectorCompanies.sectorId, sectorId));
    expect(membership).toBeUndefined();
  });
});
