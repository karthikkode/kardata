import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { apolloProfileCollector } from "../../src/collect/collectors/apollo-profile.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import {
  collectorCtx,
  factsForRun,
  seedApolloImportSource,
  seedCompany,
  seedRun,
  sourceById,
} from "./helpers.js";
import { startFakeSite, type FakeSite } from "./fake-site.js";

let handle: DbHandle;
let site: FakeSite;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
});

afterEach(async () => {
  await site.close();
});

afterAll(async () => {
  await handle.close();
});

describe("apollo_profile collector", () => {
  it("writes financial facts citing the import source", async () => {
    const companyId = await seedCompany(handle.db, {
      source: "apollo",
      apolloAccountId: "apollo-facts-1",
      annualRevenue: "25000000",
      totalFunding: "5000000",
      employees: 42,
      foundedYear: 2019,
    });
    const apolloSourceId = await seedApolloImportSource(handle.db, companyId);
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);

    const result = await apolloProfileCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "financials", status: "done" }]);

    const factRows = await factsForRun(handle.db, runId);
    expect(factRows).toHaveLength(4);
    expect(factRows.every((f) => f.createdBy === "collector:apollo_profile")).toBe(true);
    expect(factRows.every((f) => f.sourceIds.length === 1 && f.sourceIds[0] === apolloSourceId)).toBe(true);
    const source = await sourceById(handle.db, apolloSourceId);
    expect(source?.collector).toBe("apollo_import");

    const byKey = new Map(factRows.map((f) => [f.key, f]));
    const revenue = byKey.get("financials.revenue_estimate");
    expect(revenue?.valueJson).toEqual({ amount: 25000000 });
    expect(revenue?.currency).toBe("USD");
    expect(revenue?.qualifiers).toEqual({ source: "apollo" });
    const funding = byKey.get("financials.total_funding");
    expect(funding?.valueJson).toEqual({ amount: 5000000 });
    expect(funding?.currency).toBe("USD");
    expect(byKey.get("financials.employees")?.valueNum).toBe("42");
    expect(byKey.get("financials.employees")?.qualifiers).toEqual({ source: "apollo" });
    expect(byKey.get("company.founded_year")?.valueNum).toBe("2019");
  });

  it("skips missing values and writes no facts without the import source", async () => {
    const partialId = await seedCompany(handle.db, {
      source: "apollo",
      apolloAccountId: "apollo-facts-2",
      employees: 7,
    });
    await seedApolloImportSource(handle.db, partialId);
    const partialRun = await seedRun(handle.db, partialId);
    const partialResult = await apolloProfileCollector.run(
      await collectorCtx(handle.db, site, partialId, partialRun),
    );
    expect(partialResult.outcomes).toEqual([{ area: "financials", status: "done" }]);
    const partialFacts = await factsForRun(handle.db, partialRun);
    expect(partialFacts.map((f) => f.key)).toEqual(["financials.employees"]);

    const sourcelessId = await seedCompany(handle.db, {
      source: "apollo",
      apolloAccountId: "apollo-facts-3",
      annualRevenue: "1000000",
    });
    const sourcelessRun = await seedRun(handle.db, sourcelessId);
    const sourcelessResult = await apolloProfileCollector.run(
      await collectorCtx(handle.db, site, sourcelessId, sourcelessRun),
    );
    expect(sourcelessResult.outcomes).toEqual([{ area: "financials", status: "done" }]);
    expect(await factsForRun(handle.db, sourcelessRun)).toHaveLength(0);
  });
});
