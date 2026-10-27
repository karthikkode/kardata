import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { eq } from "drizzle-orm";
import { companies, sectorCompanies, sectorPreflight, sectors } from "../../src/db/schema.js";
import { PRIMARY_CATEGORIES } from "../../src/domain/sector-preflight/classify.js";
import { DEFAULT_SKINCARE_RUBRIC } from "../../src/domain/sector-preflight/eligibility.js";
import {
  SKINCARE_PROFILE,
  categoryKeys,
  getProfile,
  getProfileOrNull,
  setProfile,
} from "../../src/domain/sector-preflight/profile.js";
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
    await setProfile(handle.db, sectorId, SKINCARE_PROFILE);
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
      primaryCategory: "skincare",
      sellsOwnProducts: true,
      hasOnlineStore: true,
      shipsTo: [],
      confidence: "high",
      reason: "synthetic",
    });
    const renamed = {
      ...SKINCARE_PROFILE,
      categories: SKINCARE_PROFILE.categories.map((c) =>
        c.key === "skincare" ? { ...c, key: "skin_care" } : c,
      ),
      scope: {
        ...SKINCARE_PROFILE.scope,
        coreCategories: ["skin_care", "body_bath", "mens_grooming"],
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

  it("stores the skincare seed unchanged (same categories as the old enum)", async () => {
    const sectorId = await makeSector("skincare");
    const result = await setProfile(handle.db, sectorId, SKINCARE_PROFILE);
    expect(categoryKeys(result.profile)).toEqual([...PRIMARY_CATEGORIES]);
    expect(result.profile.scope.coreCategories).toEqual(DEFAULT_SKINCARE_RUBRIC.eligible.primaryCategories);
    expect(result.profile.scope.adjacentCategories).toEqual(DEFAULT_SKINCARE_RUBRIC.review.primaryCategories);
    const [membership] = await handle.db
      .select()
      .from(sectorCompanies)
      .where(eq(sectorCompanies.sectorId, sectorId));
    expect(membership).toBeUndefined();
  });
});
