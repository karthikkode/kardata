import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, facts, sectors, sectorCompanies } from "../../src/db/schema.js";
import {
  companyRevenueTruth,
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
  await handle.db.insert(sectors).values({ id, name: "test-sector" });
  return id;
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
        status: "contactable",
        source: "test-check",
      },
    ]);

    const truth = await companyRevenueTruth(handle.db, companyId);
    expect(truth.revenueUsed).toBe(17 * 175000);
    expect(truth.revenueSource).toBe("staff_estimate");
    expect(truth.rejected?.reason).toBe("rejected: below $75k per staff");
    expect(truth.staff).toEqual({ count: 17, source: "companies_house", asOf: "2025-09-30" });
    expect(truth.tier).toBe("B");
    expect(truth.layer).toBe(5);
    expect(truth.status).toBe("contactable");

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
});
