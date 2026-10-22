import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, sectorCompanies, sectorPreflight, sectors } from "../../src/db/schema.js";
import {
  DEFAULT_SKINCARE_RUBRIC,
  applySectorScope,
  deriveCompany,
  eligibilityCounts,
  getRubric,
  rederiveSector,
  setOverride,
  setRubric,
} from "../../src/domain/sector-preflight/eligibility.js";
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

async function addCompany(sectorId: string, name: string): Promise<string> {
  const [company] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name })
    .returning({ id: companies.id });
  if (!company) throw new Error("no company row");
  await handle.db.insert(sectorCompanies).values({ sectorId, companyId: company.id, addedVia: "manual" });
  return company.id;
}

async function classify(sectorId: string, companyId: string, patch: Record<string, unknown> = {}): Promise<void> {
  await handle.db.insert(sectorPreflight).values({
    id: randomUUID(),
    sectorId,
    companyId,
    businessType: "dtc_brand",
    primaryCategory: "skincare",
    sellsOwnProducts: true,
    hasOnlineStore: true,
    confidence: "high",
    reason: "test",
    ...patch,
  });
}

async function membership(sectorId: string, companyId: string) {
  const [row] = await handle.db
    .select()
    .from(sectorCompanies)
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));
  return row;
}

describe("sector eligibility", () => {
  it("defaults to the skincare rubric and pending memberships", async () => {
    const sectorId = await makeSector("Skincare");
    const companyId = await addCompany(sectorId, "A Co");
    await expect(getRubric(handle.db, sectorId)).resolves.toEqual({ rubric: DEFAULT_SKINCARE_RUBRIC, isDefault: true });
    expect((await membership(sectorId, companyId))?.eligibility).toBe("pending");
    await deriveCompany(handle.db, sectorId, companyId);
    expect((await membership(sectorId, companyId))?.eligibility).toBe("pending");
  });

  it("derives eligible/review/ineligible from classifications", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    const c = await addCompany(sectorId, "C Co");
    await classify(sectorId, a);
    await classify(sectorId, b, { businessType: "clinic_medical" });
    await classify(sectorId, c, { businessType: "unknown", confidence: "low" });
    await expect(deriveCompany(handle.db, sectorId, a)).resolves.toMatchObject({ eligibility: "eligible", source: "rule" });
    await expect(deriveCompany(handle.db, sectorId, b)).resolves.toMatchObject({ eligibility: "ineligible" });
    await expect(deriveCompany(handle.db, sectorId, c)).resolves.toMatchObject({ eligibility: "review" });
    await expect(eligibilityCounts(handle.db, sectorId)).resolves.toEqual({ pending: 0, eligible: 1, review: 1, ineligible: 1 });
  });

  it("applies the binary sector scope, skipping overrides and pending rows", async () => {
    const sectorId = await makeSector("Skincare");
    const core = await addCompany(sectorId, "Skin Co");
    const adjacent = await addCompany(sectorId, "Glam Co");
    const rejected = await addCompany(sectorId, "Lens Co");
    const overridden = await addCompany(sectorId, "Kept Co");
    const pending = await addCompany(sectorId, "New Co");
    await classify(sectorId, core);
    await classify(sectorId, adjacent, { primaryCategory: "cosmetics_makeup", reason: "makeup with SPF skincare" });
    await classify(sectorId, rejected, { primaryCategory: "other", reason: "sells contact lenses" });
    await classify(sectorId, overridden, { primaryCategory: "other", reason: "sells contact lenses" });
    await setOverride(handle.db, sectorId, overridden, "include", "owner call");
    const result = await applySectorScope(handle.db, sectorId);
    expect(result).toEqual({ eligible: 2, ineligible: 1, skippedOverride: 1, skippedPending: 1 });
    expect((await membership(sectorId, core))?.eligibility).toBe("eligible");
    expect((await membership(sectorId, adjacent))?.eligibility).toBe("eligible");
    expect((await membership(sectorId, adjacent))?.eligibilityReason).toContain("skin-related");
    expect((await membership(sectorId, rejected))?.eligibility).toBe("ineligible");
    expect((await membership(sectorId, overridden))?.eligibility).toBe("eligible");
    expect((await membership(sectorId, overridden))?.eligibilitySource).toBe("override");
    expect((await membership(sectorId, pending))?.eligibility).toBe("pending");
  });

  it("overrides win and clear restores the rule", async () => {
    const sectorId = await makeSector("Skincare");
    const companyId = await addCompany(sectorId, "A Co");
    await classify(sectorId, companyId, { businessType: "clinic_medical" });
    await expect(setOverride(handle.db, sectorId, companyId, "include", "owner call")).resolves.toMatchObject({
      eligibility: "eligible",
      source: "override",
    });
    expect((await membership(sectorId, companyId))?.eligibilityReason).toBe("owner call");
    await expect(setOverride(handle.db, sectorId, companyId, "clear")).resolves.toMatchObject({
      eligibility: "ineligible",
      source: "rule",
    });
  });

  it("re-derives instantly on a rubric change with before/after counts", async () => {
    const sectorId = await makeSector("Skincare");
    const companyId = await addCompany(sectorId, "A Co");
    await classify(sectorId, companyId, { primaryCategory: "haircare" });
    await deriveCompany(handle.db, sectorId, companyId);
    expect((await membership(sectorId, companyId))?.eligibility).toBe("review");
    const wider = {
      ...DEFAULT_SKINCARE_RUBRIC,
      eligible: { ...DEFAULT_SKINCARE_RUBRIC.eligible, primaryCategories: ["skincare", "haircare"] },
    };
    const result = await setRubric(handle.db, sectorId, wider);
    expect(result.before).toMatchObject({ review: 1 });
    expect(result.after).toMatchObject({ eligible: 1 });
    expect((await membership(sectorId, companyId))?.eligibility).toBe("eligible");
    await expect(setRubric(handle.db, sectorId, { nope: true })).rejects.toThrow(/invalid rubric/);
  });

  it("rederiveSector covers every membership", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    await addCompany(sectorId, "B Co");
    await classify(sectorId, a);
    await expect(rederiveSector(handle.db, sectorId)).resolves.toEqual({ pending: 1, eligible: 1, review: 0, ineligible: 0 });
  });
});
