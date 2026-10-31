import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { earlyTripDecision, quotaEarlyTripRatioGet, quotaEarlyTripRatioSet } from "../../src/domain/quota/breaker.js";
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

describe("quota early trip ratio (follow-up)", () => {
  it("defaults to 0.90 and persists an operator value", async () => {
    expect(await quotaEarlyTripRatioGet(handle.db)).toEqual({ ratio: 0.9, source: "default", dbValue: null });
    await quotaEarlyTripRatioSet(handle.db, 0.85);
    expect(await quotaEarlyTripRatioGet(handle.db)).toEqual({ ratio: 0.85, source: "db", dbValue: 0.85 });
    await expect(quotaEarlyTripRatioSet(handle.db, 1)).rejects.toThrowError(/between 0 and 1/);
  });

  it("trips on the live weekly reading when uncalibrated", () => {
    expect(earlyTripDecision({ ratio: 0.9, calibrated: false, burnTotal: 0, allowanceEstimate: 0, weeklyPct: 89 })).toBe(false);
    expect(earlyTripDecision({ ratio: 0.9, calibrated: false, burnTotal: 0, allowanceEstimate: 0, weeklyPct: 90 })).toBe(true);
    expect(earlyTripDecision({ ratio: 0.9, calibrated: true, burnTotal: 89, allowanceEstimate: 100, weeklyPct: null })).toBe(false);
    expect(earlyTripDecision({ ratio: 0.9, calibrated: true, burnTotal: 90, allowanceEstimate: 100, weeklyPct: null })).toBe(true);
  });
});
