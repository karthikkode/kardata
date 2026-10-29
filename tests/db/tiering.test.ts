import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import {
  companies,
  facts,
  sectors,
  sectorCompanies,
} from "../../src/db/schema.js";
import {
  companyRevenueTruth,
  recordRevenueConfirmation,
  recordVerdicts,
  sectorSheetRows,
  sectorTierSummary,
  sheetCsv,
} from "../../src/domain/tiering.js";
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

async function seedCompany(name: string): Promise<string> {
  const id = randomUUID();
  await handle.db.insert(companies).values({ id, source: "manual", name });
  return id;
}

async function seedSector(): Promise<string> {
  const id = randomUUID();
  await handle.db.insert(sectors).values({ id, name: `test-sector-${id.slice(0, 8)}` });
  return id;
}

async function seedSectorPress(sectorId: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { parseSectorProfile, setProfile } = await import("../../src/domain/sector-preflight/profile.js");
  const raw = JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8"));
  await setProfile(handle.db, sectorId, parseSectorProfile({
    ...raw,
    tiering: { ...raw.tiering, pressSources: ["wwd"] },
  }));
}

async function seedFact(
  companyId: string,
  key: string,
  value: { num?: number; text?: string; json?: unknown; currency?: string },
  qualifiers: Record<string, string>,
  asOf: string | null = null,
): Promise<void> {
  await handle.db.insert(facts).values({
    id: randomUUID(),
    companyId,
    key,
    area: "financials",
    valueNum: value.num !== undefined ? String(value.num) : null,
    valueText: value.text ?? null,
    valueJson: value.json ?? null,
    currency: value.currency ?? null,
    qualifiers,
    asOf,
    sourceIds: [randomUUID()],
    confidence: "high",
    createdBy: "test",
  });
}

describe("tiering against stored facts and verdicts", () => {
  it("computes the case-company shape: Apollo rejected, staff fallback, Tier B", async () => {
    const sectorId = await seedSector();
    const companyId = await seedCompany("Case Co");
    await handle.db
      .insert(sectorCompanies)
      .values({ sectorId, companyId, addedVia: "manual" });
    await seedFact(
      companyId,
      "financials.revenue_estimate",
      { json: { amount: 607000 }, currency: "USD" },
      { source: "apollo", estimate_kind: "vendor", estimate_status: "unverified" },
    );
    await seedFact(companyId, "financials.employees", { num: 20 }, { source: "apollo" });
    await seedFact(
      companyId,
      "financials.employees",
      { num: 17 },
      { source: "companies_house" },
      "2025-09-30",
    );
    await recordVerdicts(handle.db, [
      {
        companyId,
        sectorId,
        score: 2,
        signals: { S1: true, S3: true },
        status: "icp_accepted",
        source: "test-check",
      },
    ]);

    const truth = await companyRevenueTruth(handle.db, companyId, sectorId);
    expect(truth.revenueUsed).toBe(17 * 175000);
    expect(truth.revenueSource).toBe("staff_estimate");
    expect(truth.rejected?.reason).toBe("rejected: below $75k per staff");
    expect(truth.staff).toEqual({ count: 17, source: "companies_house", asOf: "2025-09-30" });
    expect(truth.tier).toBe("B");
    expect(truth.layer).toBe(5);
    expect(truth.status).toBe("icp_accepted");

    const summary = await sectorTierSummary(handle.db, sectorId);
    expect(summary.companiesWithVerdicts).toBe(1);
    expect(summary.byTierLayer).toEqual({ "B/L5": 1 });
    expect(summary.byRevenueSource).toEqual({ staff_estimate: 1 });

    const rows = await sectorSheetRows(handle.db, sectorId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: "B", layer: 5, score: 2, revenueSource: "estimated from staff" });
    const csv = sheetCsv(rows);
    expect(csv).toContain("Tier B");
    expect(csv).toContain("Tier,Layer,Score,Company,Domain,Country,Revenue used,Revenue source,Flags");
  });


  it("a flagged public figure waits for confirmation before setting the tier", async () => {
    const sectorId = await seedSector();
    await seedSectorPress(sectorId);
    const companyId = await seedCompany("Flagged Co");
    await handle.db
      .insert(sectorCompanies)
      .values({ sectorId, companyId, addedVia: "manual" });
    await seedFact(
      companyId,
      "financials.revenue_estimate",
      { json: { amount: 50000000 }, currency: "USD" },
      { source: "WWD" },
    );
    await seedFact(companyId, "financials.employees", { num: 20 }, { source: "apollo" });
    await recordVerdicts(handle.db, [
      {
        companyId,
        sectorId,
        score: 4,
        signals: { S1: true },
        status: "icp_accepted",
        source: "test-check",
      },
    ]);

    const waiting = await companyRevenueTruth(handle.db, companyId, sectorId);
    expect(waiting.revenueSource).toBe("staff_estimate");
    expect(waiting.tier).toBe("B");
    expect(waiting.flaggedFigure?.amount).toBe(50000000);

    await recordRevenueConfirmation(handle.db, {
      companyId,
      decision: "confirm",
      reason: "founder stated the brand's own figure in the interview",
    });
    const confirmed = await companyRevenueTruth(handle.db, companyId, sectorId);
    expect(confirmed.revenueSource).toBe("public");
    expect(confirmed.tier).toBe("A");

    await recordRevenueConfirmation(handle.db, {
      companyId,
      decision: "reject",
      reason: "parent-company figure",
    });
    const rejected = await companyRevenueTruth(handle.db, companyId, sectorId);
    expect(rejected.revenueSource).toBe("staff_estimate");
    expect(rejected.flaggedFigure?.reason).toBe("parent-company figure");
  });
});

describe("verdicts per sector (Stage 5.6 B4)", () => {
  it("keeps one verdict per sector for the same company and reads the sector's own", async () => {
    const sectorA = await seedSector();
    const sectorB = await seedSector();
    const companyId = await seedCompany("Two Sector Co");
    await handle.db.insert(sectorCompanies).values({ sectorId: sectorA, companyId, addedVia: "manual" });
    await handle.db.insert(sectorCompanies).values({ sectorId: sectorB, companyId, addedVia: "manual" });
    await seedFact(companyId, "financials.employees", { num: 20 }, { source: "apollo" });
    await recordVerdicts(handle.db, [
      { companyId, sectorId: sectorA, score: 5, signals: {}, status: "icp_accepted", source: "test" },
      { companyId, sectorId: sectorB, score: 0, signals: {}, status: "icp_watchlist", source: "test" },
    ]);
    const a = await companyRevenueTruth(handle.db, companyId, sectorA);
    const b = await companyRevenueTruth(handle.db, companyId, sectorB);
    expect(a.score).toBe(5);
    expect(a.status).toBe("icp_accepted");
    expect(b.score).toBe(0);
    expect(b.status).toBe("icp_watchlist");
    // Re-recording one sector leaves the other untouched.
    await recordVerdicts(handle.db, [
      { companyId, sectorId: sectorA, score: 3, signals: {}, status: "icp_accepted", source: "test" },
    ]);
    expect((await companyRevenueTruth(handle.db, companyId, sectorA)).score).toBe(3);
    expect((await companyRevenueTruth(handle.db, companyId, sectorB)).score).toBe(0);
  });

  it("resolveCompanySector uses a given sector, the only sector, else refuses", async () => {
    const { resolveCompanySector } = await import("../../src/domain/sectors.js");
    const sectorA = await seedSector();
    const sectorB = await seedSector();
    const solo = await seedCompany("Solo Co");
    const dual = await seedCompany("Dual Co");
    const none = await seedCompany("No Sector Co");
    await handle.db.insert(sectorCompanies).values({ sectorId: sectorA, companyId: solo, addedVia: "manual" });
    await handle.db.insert(sectorCompanies).values({ sectorId: sectorA, companyId: dual, addedVia: "manual" });
    await handle.db.insert(sectorCompanies).values({ sectorId: sectorB, companyId: dual, addedVia: "manual" });
    await expect(resolveCompanySector(handle.db, solo)).resolves.toBe(sectorA);
    await expect(resolveCompanySector(handle.db, dual, sectorB)).resolves.toBe(sectorB);
    await expect(resolveCompanySector(handle.db, dual)).rejects.toThrow(/company is in 2 sectors; pass sectorId/);
    await expect(resolveCompanySector(handle.db, none)).rejects.toThrow(/company is in 0 sectors; pass sectorId/);
  });
});
