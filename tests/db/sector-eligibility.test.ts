import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, sectorCompanies, sectorPreflight, sectors } from "../../src/db/schema.js";
import {
  deriveCompany,
  eligibilityCounts,
  rederiveSectorScope,
  setOverride,
} from "../../src/domain/sector-preflight/eligibility.js";
import { parseSectorProfile, setProfile } from "../../src/domain/sector-preflight/profile.js";
import { startSectorPreflight } from "../../src/runs/sector.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const TEST_PROFILE = parseSectorProfile(
  JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
);

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

async function makeSector(name: string, withProfile = true): Promise<string> {
  const [row] = await handle.db
    .insert(sectors)
    .values({ id: randomUUID(), name })
    .returning({ id: sectors.id });
  if (!row) throw new Error("no sector row");
  if (withProfile) await setProfile(handle.db, row.id, TEST_PROFILE);
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
    primaryCategory: "widgets",
    sellsOwnProducts: true,
    hasOnlineStore: true,
    confidence: "high",
    reason: "test storefront sells its own widgets",
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

describe("sector eligibility (scope only)", () => {
  it("stays pending without a classification or a profile refusal path", async () => {
    const sectorId = await makeSector("Sample Sector");
    const companyId = await addCompany(sectorId, "A Co");
    await expect(deriveCompany(handle.db, sectorId, companyId)).resolves.toEqual({
      eligibility: "pending",
      source: null,
      reason: null,
    });
    expect((await membership(sectorId, companyId))?.eligibility).toBe("pending");
  });

  it("derives eligible for in-scope D2C core, ineligible otherwise, never review", async () => {
    const sectorId = await makeSector("Sample Sector");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    const c = await addCompany(sectorId, "C Co");
    await classify(sectorId, a);
    await classify(sectorId, b, { businessType: "clinic_medical" });
    await classify(sectorId, c, { primaryCategory: "gadgets", reason: "sells gadgets direct" });
    await expect(deriveCompany(handle.db, sectorId, a)).resolves.toMatchObject({ eligibility: "eligible", source: "rule" });
    await expect(deriveCompany(handle.db, sectorId, b)).resolves.toMatchObject({ eligibility: "ineligible" });
    await expect(deriveCompany(handle.db, sectorId, c)).resolves.toMatchObject({ eligibility: "ineligible" });
    await expect(eligibilityCounts(handle.db, sectorId)).resolves.toEqual({
      pending: 0,
      eligible: 1,
      review: 0,
      ineligible: 2,
    });
  });

  it("lets overrides win both ways and clear restores the scope verdict", async () => {
    const sectorId = await makeSector("Sample Sector");
    const companyId = await addCompany(sectorId, "A Co");
    await classify(sectorId, companyId, { businessType: "clinic_medical" });
    await expect(setOverride(handle.db, sectorId, companyId, "include", "owner knows")).resolves.toEqual({
      eligibility: "eligible",
      source: "override",
      reason: "owner knows",
    });
    await expect(setOverride(handle.db, sectorId, companyId, "clear")).resolves.toMatchObject({
      eligibility: "ineligible",
      source: "rule",
    });
    await expect(setOverride(handle.db, sectorId, companyId, "exclude", "out")).resolves.toMatchObject({
      eligibility: "ineligible",
      source: "override",
    });
  });

  it("rederiveSectorScope covers every membership and skips overrides in its tally", async () => {
    const sectorId = await makeSector("Sample Sector");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    await addCompany(sectorId, "C Co");
    await classify(sectorId, a);
    await classify(sectorId, b, { businessType: "clinic_medical" });
    await setOverride(handle.db, sectorId, b, "include", "keep");
    const result = await rederiveSectorScope(handle.db, sectorId);
    expect(result).toEqual({ eligible: 1, ineligible: 0, skippedOverride: 1, skippedPending: 1 });
    await expect(eligibilityCounts(handle.db, sectorId)).resolves.toEqual({
      pending: 1,
      eligible: 2,
      review: 0,
      ineligible: 0,
    });
  });

  it("refuses preflight and scope for a sector with no profile, in plain words", async () => {
    const sectorId = await makeSector("No Profile Sector", false);
    const companyId = await addCompany(sectorId, "A Co");
    await classify(sectorId, companyId);
    await expect(startSectorPreflight(handle.db, { sectorId })).rejects.toThrow(/has no profile/);
    await expect(rederiveSectorScope(handle.db, sectorId)).rejects.toThrow(/has no profile/);
    await expect(deriveCompany(handle.db, sectorId, companyId)).rejects.toThrow(/has no profile/);
  });

  it("re-derives on profile save when classifications exist", async () => {
    const sectorId = await makeSector("Sample Sector");
    const companyId = await addCompany(sectorId, "A Co");
    await classify(sectorId, companyId);
    await deriveCompany(handle.db, sectorId, companyId);
    expect((await membership(sectorId, companyId))?.eligibility).toBe("eligible");
    const narrower = {
      ...JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
      scope: { ...TEST_PROFILE.scope, businessTypes: ["brand_retail_only"] },
    };
    const result = await setProfile(handle.db, sectorId, narrower);
    expect(result.after.eligible).toBe(0);
    expect(result.after.ineligible).toBe(1);
    expect((await membership(sectorId, companyId))?.eligibility).toBe("ineligible");
  });
});
