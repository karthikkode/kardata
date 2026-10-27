import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { eq } from "drizzle-orm";
import { sectorCompanies, sectors } from "../../src/db/schema.js";
import { PRIMARY_CATEGORIES } from "../../src/domain/sector-preflight/classify.js";
import { DEFAULT_SKINCARE_RUBRIC } from "../../src/domain/sector-preflight/eligibility.js";
import {
  SKINCARE_PROFILE,
  categoryKeys,
  getProfile,
  getProfileOrNull,
  setProfile,
} from "../../src/domain/sector-preflight/profile.js";
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
      scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [] },
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
