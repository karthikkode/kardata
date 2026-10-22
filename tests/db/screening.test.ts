import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { researchRuns, sources } from "../../src/db/schema.js";
import { addCompany, removeCompany, updateCompany } from "../../src/domain/companies.js";
import { createSector } from "../../src/domain/sectors.js";
import { addFacts } from "../../src/domain/research/facts.js";
import {
  getShortlist,
  listShortlists,
  saveShortlist,
  screenCompanies,
  type ScreenCriterion,
  type ScreenSort,
} from "../../src/domain/screening.js";
import { DomainError } from "../../src/domain/errors.js";
import {
  ensureMigrated,
  fixtureCsvPath,
  fixtureImportDirs,
  getTestDb,
  resetTestDb,
} from "../db.js";

let handle: DbHandle;
const DIRS = fixtureImportDirs();

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

async function seed(name = "Skincare"): Promise<string> {
  const { sector } = await createSector(
    handle.db,
    { name, csvPaths: [fixtureCsvPath()] },
    { importDirs: DIRS },
  );
  return sector.id;
}

async function liveIds(sectorId: string): Promise<string[]> {
  const rows = (await handle.db.execute(
    sql`SELECT c.id AS id FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE m.sector_id = ${sectorId} AND m.removed_at IS NULL ORDER BY c.id`,
  )) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

async function groundIds(sectorId: string, where: SQL): Promise<string[]> {
  const rows = (await handle.db.execute(
    sql`SELECT c.id AS id FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE m.sector_id = ${sectorId} AND m.removed_at IS NULL AND (${where})`,
  )) as unknown as { id: string }[];
  return rows.map((r) => r.id).sort();
}

async function expectScreen(
  sectorId: string,
  criteria: ScreenCriterion[],
  where: SQL,
  opts: { sort?: ScreenSort; limit?: number; verifiedOnly?: boolean; includeUnverified?: boolean } = {},
): Promise<void> {
  const result = await screenCompanies(handle.db, sectorId, {
    criteria,
    sort: opts.sort,
    limit: opts.limit,
    verifiedOnly: opts.verifiedOnly,
    includeUnverified: opts.includeUnverified,
  });
  expect([...result.ids].sort()).toEqual(await groundIds(sectorId, where));
  expect(result.total).toEqual((await groundIds(sectorId, where)).length);
}

async function makeRun(companyId: string): Promise<string> {
  const [row] = await handle.db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "manual", status: "succeeded" })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("no run row");
  return row.id;
}

async function makeSource(companyId: string, runId: string): Promise<string> {
  const [row] = await handle.db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId,
      runId,
      url: "http://example.invalid/",
      finalUrl: "http://example.invalid/",
      collector: "test",
      status: "ok",
      httpStatus: 200,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("no source row");
  return row.id;
}

async function addFactOk(
  companyId: string,
  key: string,
  value: unknown,
  qualifiers?: Record<string, string>,
): Promise<void> {
  const runId = await makeRun(companyId);
  const sourceId = await makeSource(companyId, runId);
  const [result] = await addFacts(handle.db, {
    companyId,
    runId,
    createdBy: "owner",
    facts: [{ key, value, qualifiers, sourceIds: [sourceId] }],
  });
  if (!result?.ok) throw new Error(`fact write failed: ${JSON.stringify(result)}`);
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`expected DomainError ${code}, but the call succeeded`);
}

describe("company_screen fields", () => {
  it("eq/ne on country", async () => {
    const sectorId = await seed();
    await expectScreen(sectorId, [{ field: "country", op: "eq", value: "Canada" }], sql`c.country = 'Canada'`);
    await expectScreen(sectorId, [{ field: "country", op: "ne", value: "Canada" }], sql`c.country <> 'Canada'`);
  });

  it("range ops on employees, and a between as gte + lte", async () => {
    const sectorId = await seed();
    await expectScreen(sectorId, [{ field: "employees", op: "gt", value: 200 }], sql`c.employees > 200`);
    await expectScreen(sectorId, [{ field: "employees", op: "gte", value: 200 }], sql`c.employees >= 200`);
    await expectScreen(sectorId, [{ field: "employees", op: "lt", value: 20 }], sql`c.employees < 20`);
    await expectScreen(sectorId, [{ field: "employees", op: "lte", value: 20 }], sql`c.employees <= 20`);
    await expectScreen(
      sectorId,
      [
        { field: "employees", op: "gte", value: 20 },
        { field: "employees", op: "lte", value: 200 },
      ],
      sql`c.employees >= 20 AND c.employees <= 200`,
    );
  });

  it("in on industry", async () => {
    const sectorId = await seed();
    await expectScreen(
      sectorId,
      [{ field: "industry", op: "in", value: ["skincare", "beauty supply"] }],
      sql`c.industry IN ('skincare', 'beauty supply')`,
    );
  });

  it("exists/not_exists on totalFunding", async () => {
    const sectorId = await seed();
    await expectScreen(sectorId, [{ field: "totalFunding", op: "exists" }], sql`c.total_funding IS NOT NULL`);
    await expectScreen(sectorId, [{ field: "totalFunding", op: "not_exists" }], sql`c.total_funding IS NULL`);
  });

  it("bool eq on sharedDomain and source eq", async () => {
    const sectorId = await seed();
    await expectScreen(sectorId, [{ field: "sharedDomain", op: "eq", value: false }], sql`c.shared_domain = false`);
    await expectScreen(sectorId, [{ field: "source", op: "eq", value: "apollo" }], sql`c.source = 'apollo'`);
  });

  it("sees overrides, not just imported columns", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await updateCompany(handle.db, ids[0] as string, { country: "Atlantis", employees: 9999 });
    await expectScreen(sectorId, [{ field: "country", op: "eq", value: "Atlantis" }], sql`c.id = ${ids[0]}`);
    await expectScreen(sectorId, [{ field: "employees", op: "gt", value: 9000 }], sql`c.id = ${ids[0]}`);
  });

  it("excludes removed companies", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await removeCompany(handle.db, sectorId, ids[0] as string);
    const result = await screenCompanies(handle.db, sectorId, { criteria: [] });
    expect(result.total).toBe(ids.length - 1);
    expect(result.ids).not.toContain(ids[0]);
  });
});

describe("company_screen facts", () => {
  it("bool eq/ne on business_model.subscription", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await addFactOk(ids[0] as string, "business_model.subscription", true);
    await addFactOk(ids[1] as string, "business_model.subscription", false);
    await expectScreen(
      sectorId,
      [{ factKey: "business_model.subscription", op: "eq", value: true }],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'business_model.subscription' AND fc.value_bool = true)`,
      { includeUnverified: true },
    );
    await expectScreen(
      sectorId,
      [{ factKey: "business_model.subscription", op: "ne", value: true }],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'business_model.subscription' AND fc.value_bool <> true)`,
      { includeUnverified: true },
    );
  });

  it("number gte on product.count reads the current row only", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await addFactOk(ids[0] as string, "product.count", 5);
    await addFactOk(ids[0] as string, "product.count", 50);
    await addFactOk(ids[1] as string, "product.count", 10);
    await expectScreen(
      sectorId,
      [{ factKey: "product.count", op: "gte", value: 20 }],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'product.count' AND fc.value_num >= 20)`,
      { includeUnverified: true },
    );
    const result = await screenCompanies(handle.db, sectorId, {
      criteria: [{ factKey: "product.count", op: "gte", value: 20 }],
      includeUnverified: true,
    });
    expect(result.ids).toEqual([ids[0]]);
    expect(result.items[0]?.matched["0"]).toEqual([50]);
  });

  it("qualifier subset on marketing.channel_active", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await addFactOk(ids[0] as string, "marketing.channel_active", true, { channel: "meta" });
    await addFactOk(ids[0] as string, "marketing.channel_active", false, { channel: "tiktok" });
    await addFactOk(ids[1] as string, "marketing.channel_active", true, { channel: "tiktok" });
    await expectScreen(
      sectorId,
      [{ factKey: "marketing.channel_active", qualifiers: { channel: "meta" }, op: "eq", value: true }],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'marketing.channel_active' AND fc.qualifiers @> '{"channel":"meta"}'::jsonb AND fc.value_bool = true)`,
      { includeUnverified: true },
    );
    const unqualified = await screenCompanies(handle.db, sectorId, {
      criteria: [{ factKey: "marketing.channel_active", op: "eq", value: true }],
      includeUnverified: true,
    });
    expect([...unqualified.ids].sort()).toEqual([ids[0], ids[1]].sort());
    expect(unqualified.items.find((i) => i.id === ids[0])?.matched["0"]).toEqual([true]);
  });

  it("defaults to grounded rows; verifiedOnly narrows; includeUnverified shows all", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await addFactOk(ids[0] as string, "product.count", 50);
    await addFactOk(ids[1] as string, "product.count", 60);
    await addFactOk(ids[2] as string, "product.count", 70);
    await handle.db.execute(
      sql`UPDATE facts SET verification = 'verified' WHERE company_id = ${ids[0]} AND key = 'product.count'`,
    );
    await handle.db.execute(
      sql`UPDATE facts SET verification = 'doc_only' WHERE company_id = ${ids[1]} AND key = 'product.count'`,
    );
    const criterion = { factKey: "product.count", op: "gte", value: 20 } as const;
    await expectScreen(
      sectorId,
      [criterion],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'product.count' AND fc.verification IN ('verified', 'doc_only') AND fc.value_num >= 20)`,
    );
    await expectScreen(
      sectorId,
      [criterion],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'product.count' AND fc.verification = 'verified' AND fc.value_num >= 20)`,
      { verifiedOnly: true },
    );
    const strict = await screenCompanies(handle.db, sectorId, { criteria: [criterion], verifiedOnly: true });
    expect(strict.ids).toEqual([ids[0]]);
    expect(strict.items[0]?.matched["0"]).toEqual([50]);
    const grounded = await screenCompanies(handle.db, sectorId, { criteria: [criterion] });
    expect([...grounded.ids].sort()).toEqual([ids[0], ids[1]].sort());
    expect(grounded.items.find((i) => i.id === ids[1])?.matched["0"]).toEqual([60]);
    const all = await screenCompanies(handle.db, sectorId, { criteria: [criterion], includeUnverified: true });
    expect([...all.ids].sort()).toEqual([ids[0], ids[1], ids[2]].sort());
  });

  it("in, exists and not_exists on facts", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await addFactOk(ids[0] as string, "reviews.count", 12, { platform: "onsite" });
    await addFactOk(ids[1] as string, "reviews.count", 40, { platform: "onsite" });
    await expectScreen(
      sectorId,
      [{ factKey: "reviews.count", op: "in", value: [12, 40] }],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'reviews.count' AND fc.value_num IN (12, 40))`,
      { includeUnverified: true },
    );
    await expectScreen(
      sectorId,
      [{ factKey: "reviews.count", op: "exists" }],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'reviews.count')`,
      { includeUnverified: true },
    );
    const missing = await screenCompanies(handle.db, sectorId, {
      criteria: [{ factKey: "reviews.count", op: "not_exists" }],
      includeUnverified: true,
    });
    expect(missing.total).toBe(ids.length - 2);
    expect(missing.items[0]?.matched["0"]).toEqual([]);
  });

  it("text eq on a provisional key", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await addFactOk(ids[0] as string, "test.label", "premium");
    await expectScreen(
      sectorId,
      [{ factKey: "test.label", op: "eq", value: "premium" }],
      sql`EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'test.label' AND COALESCE(fc.value_text, fc.value_date::text) = 'premium')`,
      { includeUnverified: true },
    );
  });

  it("unknown fact keys match nothing", async () => {
    const sectorId = await seed();
    const result = await screenCompanies(handle.db, sectorId, {
      criteria: [{ factKey: "nope.missing", op: "exists" }],
    });
    expect(result.total).toBe(0);
  });

  it("ANDs field and fact criteria", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    for (const id of ids.slice(0, 5)) await addFactOk(id, "product.count", 30);
    await expectScreen(
      sectorId,
      [
        { field: "country", op: "eq", value: "Canada" },
        { factKey: "product.count", op: "gte", value: 20 },
      ],
      sql`c.country = 'Canada' AND EXISTS (SELECT 1 FROM facts_current fc WHERE fc.company_id = c.id AND fc.key = 'product.count' AND fc.value_num >= 20)`,
      { includeUnverified: true },
    );
  });
});

describe("company_screen sort and limit", () => {
  it("sorts by field desc with nulls last and id tiebreaker", async () => {
    const sectorId = await seed();
    const result = await screenCompanies(handle.db, sectorId, {
      criteria: [],
      sort: { field: "totalFunding", order: "desc" },
      limit: 500,
    });
    const rows = (await handle.db.execute(
      sql`SELECT c.id AS id FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE m.sector_id = ${sectorId} AND m.removed_at IS NULL ORDER BY c.total_funding DESC NULLS LAST, c.id ASC`,
    )) as unknown as { id: string }[];
    expect(result.ids).toEqual(rows.map((r) => r.id));
  });

  it("sorts by fact key with nulls last", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    await addFactOk(ids[2] as string, "product.count", 7);
    await addFactOk(ids[0] as string, "product.count", 99);
    const result = await screenCompanies(handle.db, sectorId, {
      criteria: [],
      sort: { factKey: "product.count", order: "desc" },
      limit: 500,
    });
    expect(result.ids.slice(0, 2)).toEqual([ids[0], ids[2]]);
    expect(result.total).toBe(ids.length);
  });

  it("limits and reports the total", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    const result = await screenCompanies(handle.db, sectorId, { criteria: [], limit: 5 });
    expect(result.items).toHaveLength(5);
    expect(result.ids).toHaveLength(5);
    expect(result.total).toBe(ids.length);
  });

  it("defaults to all live companies, name order", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    const result = await screenCompanies(handle.db, sectorId);
    expect(result.total).toBe(ids.length);
    const names = result.items.map((i) => i.name);
    expect([...names].sort()).toEqual(names);
  });
});

describe("company_screen validation", () => {
  it("rejects bad criteria and options", async () => {
    const sectorId = await seed();
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ field: "nope", op: "eq", value: "x" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ field: "country", factKey: "x", op: "eq", value: "y" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ field: "country", op: "bogus" as never, value: "x" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ field: "country", op: "exists", value: "x" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ field: "country", op: "eq" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ field: "country", op: "gt", value: "x" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ field: "employees", op: "eq", value: "many" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ factKey: "product.count", op: "gte", value: "many" }] }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { criteria: [{ factKey: "product.count", op: "in", value: [1, "x"] }] }),
      "invalid_input",
    );
    await expectDomainError(screenCompanies(handle.db, sectorId, { limit: 0 }), "invalid_input");
    await expectDomainError(screenCompanies(handle.db, sectorId, { limit: 501 }), "invalid_input");
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { sort: { field: "nope" } }),
      "invalid_input",
    );
    await expectDomainError(
      screenCompanies(handle.db, sectorId, { sort: { factKey: "nope.missing" } }),
      "invalid_input",
    );
    await expectDomainError(screenCompanies(handle.db, randomUUID()), "not_found");
  });
});

describe("company_screen payload", () => {
  it("serializes 50 rows under 30 KB", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    for (let i = ids.length; i < 50; i += 1) {
      await addCompany(handle.db, sectorId, {
        name: `Extra Company Number ${i} With A Reasonably Long Name`,
        country: "United States",
        employees: 42,
        industry: "cosmetics",
        website: `https://extra-company-number-${i}.example/`,
      });
    }
    const result = await screenCompanies(handle.db, sectorId, {
      criteria: [{ field: "country", op: "eq", value: "United States" }],
      limit: 50,
    });
    expect(result.items.length).toBeGreaterThan(0);
    const bytes = Buffer.byteLength(JSON.stringify(result.items), "utf8");
    expect(bytes).toBeLessThan(30 * 1024);
  });
});

describe("shortlists", () => {
  it("saves, replaces, gets and lists", async () => {
    const sectorId = await seed();
    const ids = await liveIds(sectorId);
    const criteria = [{ field: "country", op: "eq", value: "Canada" }];
    const first = await saveShortlist(handle.db, {
      sectorId,
      name: "canada",
      companyIds: ids.slice(0, 3),
      criteria,
    });
    expect(first.companyIds).toEqual(ids.slice(0, 3));
    expect(first.criteria).toEqual(criteria);
    const replaced = await saveShortlist(handle.db, { sectorId, name: "canada", companyIds: ids.slice(0, 1) });
    expect(replaced.companyIds).toEqual(ids.slice(0, 1));
    expect(replaced.criteria).toBeNull();
    expect((await getShortlist(handle.db, sectorId, "canada")).companyIds).toEqual(ids.slice(0, 1));
    await saveShortlist(handle.db, { sectorId, name: "all", companyIds: ids });
    const lists = await listShortlists(handle.db, sectorId);
    expect(lists.map((l) => [l.name, l.companyCount])).toEqual([
      ["all", ids.length],
      ["canada", 1],
    ]);
    expect(first.createdBy).toBe("owner");
  });

  it("rejects out-of-sector ids and unknown shortlists", async () => {
    const sectorId = await seed();
    const other = await createSector(handle.db, { name: "Other" });
    const outsider = await addCompany(handle.db, other.sector.id, { name: "Outsider" });
    await expectDomainError(
      saveShortlist(handle.db, { sectorId, name: "bad", companyIds: [outsider.company.id] }),
      "invalid_input",
    );
    await expectDomainError(
      saveShortlist(handle.db, { sectorId, name: "  ", companyIds: [] }),
      "invalid_input",
    );
    await expectDomainError(getShortlist(handle.db, sectorId, "missing"), "not_found");
    await expectDomainError(listShortlists(handle.db, randomUUID()), "not_found");
  });
});
