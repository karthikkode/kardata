import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  addCompany,
  addCompanyToSector,
  bandOf,
  facets,
  getCompany,
  listCompanies,
  removeCompany,
  restoreCompany,
  updateCompany,
  type CompanySort,
  type EmployeeBand,
  type ListCompaniesOptions,
} from "../../src/domain/companies.js";
import { DomainError } from "../../src/domain/errors.js";
import { createSector } from "../../src/domain/sectors.js";
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

async function seed(name = "Skincare"): Promise<string> {
  const { sector } = await createSector(
    handle.db,
    { name, csvPaths: [fixtureCsvPath()] },
    { importDirs: DIRS },
  );
  return sector.id;
}

async function companyIdByApollo(sectorId: string, apolloId: string): Promise<string> {
  const rows = (await handle.db.execute(
    sql`SELECT c.id AS id FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE m.sector_id = ${sectorId} AND c.apollo_account_id = ${apolloId}`,
  )) as unknown as { id: string }[];
  if (!rows[0]) throw new Error(`missing company ${apolloId}`);
  return rows[0].id;
}

function likeParam(q: string): string {
  return `%${q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

const BAND_SQL: Record<EmployeeBand, SQL> = {
  "1-10": sql`(c.employees BETWEEN 1 AND 10)`,
  "11-50": sql`(c.employees BETWEEN 11 AND 50)`,
  "51-200": sql`(c.employees BETWEEN 51 AND 200)`,
  "201-500": sql`(c.employees BETWEEN 201 AND 500)`,
  "501+": sql`(c.employees >= 501)`,
};

interface TruthOptions {
  search?: string;
  country?: string[];
  employeeBand?: EmployeeBand[];
  industry?: string[];
  technologiesAny?: string[];
  hasFunding?: boolean;
  sharedDomain?: boolean;
  includeRemoved?: boolean;
  sort?: CompanySort;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/** Independent SQL ground truth over the imported columns (no overrides in these tests). */
async function groundTruth(
  sectorId: string,
  o: TruthOptions,
): Promise<{ ids: string[]; total: number }> {
  const conds: SQL[] = [sql`m.sector_id = ${sectorId}`];
  if (!o.includeRemoved) conds.push(sql`m.removed_at IS NULL`);
  const query = (o.search ?? "").trim();
  if (query !== "") {
    const q = likeParam(query);
    conds.push(
      sql`(c.name ILIKE ${q} OR c.domain ILIKE ${q} OR EXISTS (SELECT 1 FROM unnest(c.keywords) AS k WHERE k ILIKE ${q}))`,
    );
  }
  if (o.country?.length) {
    conds.push(sql`(${sql.join(o.country.map((c) => sql`c.country = ${c}`), sql` OR `)})`);
  }
  if (o.employeeBand?.length) {
    conds.push(sql`(${sql.join(o.employeeBand.map((b) => BAND_SQL[b]), sql` OR `)})`);
  }
  if (o.industry?.length) {
    conds.push(sql`(${sql.join(o.industry.map((c) => sql`c.industry = ${c}`), sql` OR `)})`);
  }
  if (o.technologiesAny?.length) {
    const techs = o.technologiesAny.map((t) => t.toLowerCase());
    conds.push(
      sql`(${sql.join(techs.map((t) => sql`EXISTS (SELECT 1 FROM unnest(c.technologies) AS u WHERE lower(u) = ${t})`), sql` OR `)})`,
    );
  }
  if (o.hasFunding !== undefined) {
    conds.push(o.hasFunding ? sql`c.total_funding IS NOT NULL` : sql`c.total_funding IS NULL`);
  }
  if (o.sharedDomain !== undefined) {
    conds.push(sql`c.shared_domain = ${o.sharedDomain}`);
  }
  const where = sql.join(conds, sql` AND `);
  const sort = o.sort ?? "name";
  const direction = o.order === "desc" ? sql`DESC` : sql`ASC`;
  const orderBy =
    sort === "name"
      ? sql`lower(c.name) COLLATE "C" ${direction}, c.id ASC`
      : sort === "employees"
        ? sql`c.employees ${direction} NULLS LAST, c.id ASC`
        : sort === "founded"
          ? sql`c.founded_year ${direction} NULLS LAST, c.id ASC`
          : sql`c.annual_revenue::numeric ${direction} NULLS LAST, c.id ASC`;
  const page = o.page ?? 1;
  const pageSize = o.pageSize ?? 50;
  const idRows = (await handle.db.execute(
    sql`SELECT c.id AS id FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE ${where} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
  )) as unknown as { id: string }[];
  const totalRows = (await handle.db.execute(
    sql`SELECT COUNT(*)::int AS n FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE ${where}`,
  )) as unknown as { n: number }[];
  return { ids: idRows.map((r) => r.id), total: totalRows[0]?.n ?? 0 };
}

async function expectMatchesTruth(sectorId: string, opts: ListCompaniesOptions): Promise<void> {
  const actual = await listCompanies(handle.db, sectorId, opts);
  const expected = await groundTruth(sectorId, opts);
  expect(actual.items.map((c) => c.id)).toEqual(expected.ids);
  expect(actual.total).toBe(expected.total);
}

describe("manual companies", () => {
  it("adds a company by hand", async () => {
    const { sector } = await createSector(handle.db, { name: "Skincare" });
    const { company, possibleDuplicates } = await addCompany(handle.db, sector.id, {
      name: "Handmade Soap Co",
      website: "https://www.handmade-soap.example/shop",
      employees: 12,
      technologies: ["Shopify"],
      notes: "owner note",
    });
    expect(company.source).toBe("manual");
    expect(company.apolloAccountId).toBeNull();
    expect(company.domain).toBe("handmade-soap.example");
    expect(company.notes).toBe("owner note");
    expect(company.sectors).toEqual([{ id: sector.id, name: "Skincare", removed: false }]);
    expect(possibleDuplicates).toEqual([]);
  });

  it("reports possible duplicates but still creates", async () => {
    const { sector } = await createSector(handle.db, { name: "Skincare" });
    const first = await addCompany(handle.db, sector.id, {
      name: "First",
      website: "https://dupe-manual.example",
    });
    const second = await addCompany(handle.db, sector.id, {
      name: "Second",
      domain: "dupe-manual.example",
    });
    expect(second.possibleDuplicates).toEqual([
      { id: first.company.id, name: "First", domain: "dupe-manual.example" },
    ]);
    expect(second.company.domain).toBe("dupe-manual.example");
    expect((await getCompany(handle.db, first.company.id)).sharedDomain).toBe(true);
    expect(second.company.sharedDomain).toBe(true);
  });

  it("validates manual input", async () => {
    const { sector } = await createSector(handle.db, { name: "Skincare" });
    await expectDomainError(addCompany(handle.db, sector.id, { name: "  " }), "invalid_input");
    await expectDomainError(
      addCompany(handle.db, sector.id, { name: "x", employees: "many" as never }),
      "invalid_input",
    );
    await expectDomainError(
      addCompany(handle.db, "00000000-0000-0000-0000-000000000000", { name: "x" }),
      "not_found",
    );
  });

  it("links an existing company, revives tombstones, rejects live dupes", async () => {
    const first = await seed("First");
    const { sector } = await createSector(handle.db, { name: "Second" });
    const id = await companyIdByApollo(first, "AP-1001");
    const linked = await addCompanyToSector(handle.db, sector.id, id);
    expect(linked.revived).toBe(false);
    await expectDomainError(addCompanyToSector(handle.db, sector.id, id), "conflict");
    await removeCompany(handle.db, sector.id, id);
    const revived = await addCompanyToSector(handle.db, sector.id, id);
    expect(revived.revived).toBe(true);
    await expectDomainError(
      addCompanyToSector(handle.db, sector.id, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );
  });
});

describe("company edits", () => {
  it("writes overrides and notes; null clears an override", async () => {
    const sectorId = await seed();
    const id = await companyIdByApollo(sectorId, "AP-1001");
    const updated = await updateCompany(handle.db, id, {
      name: "Owner Name",
      employees: 99,
      notes: "look closer",
    });
    expect(updated.name).toBe("Owner Name");
    expect(updated.employees).toBe(99);
    expect(updated.notes).toBe("look closer");
    expect(updated.overrides).toMatchObject({ name: "Owner Name", employees: 99 });
    const cleared = await updateCompany(handle.db, id, { name: null, notes: null });
    expect(cleared.name).toBe("Wren & Willow");
    expect(cleared.notes).toBeNull();
    expect(cleared.overrides).toEqual({ employees: 99 });
  });

  it("derives the effective domain from a website override", async () => {
    const sectorId = await seed();
    const id = await companyIdByApollo(sectorId, "AP-1001");
    const updated = await updateCompany(handle.db, id, {
      website: "https://www.new-domain.example/x",
    });
    expect(updated.domain).toBe("new-domain.example");
  });

  it("rejects bad patches", async () => {
    const sectorId = await seed();
    const id = await companyIdByApollo(sectorId, "AP-1001");
    await expectDomainError(updateCompany(handle.db, id, { domain: "x" }), "invalid_input");
    await expectDomainError(updateCompany(handle.db, id, { nope: 1 }), "invalid_input");
    await expectDomainError(updateCompany(handle.db, id, { employees: "x" }), "invalid_input");
    await expectDomainError(
      updateCompany(handle.db, "00000000-0000-0000-0000-000000000000", { name: "x" }),
      "not_found",
    );
  });

  it("remove and restore are idempotent; missing memberships are not_found", async () => {
    const sectorId = await seed();
    const id = await companyIdByApollo(sectorId, "AP-1001");
    await removeCompany(handle.db, sectorId, id);
    await removeCompany(handle.db, sectorId, id);
    await restoreCompany(handle.db, sectorId, id);
    await restoreCompany(handle.db, sectorId, id);
    await expectDomainError(
      removeCompany(handle.db, sectorId, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );
    await expectDomainError(
      restoreCompany(handle.db, sectorId, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );
  });

  it("getCompany carries sectors with removed flags", async () => {
    const first = await seed("First");
    const { sector } = await createSector(handle.db, { name: "Second" });
    const id = await companyIdByApollo(first, "AP-1001");
    await addCompanyToSector(handle.db, sector.id, id);
    await removeCompany(handle.db, sector.id, id);
    const company = await getCompany(handle.db, id);
    expect(company.raw["Company Name"]).toBe("Wren & Willow");
    expect(company.sectors).toHaveLength(2);
    expect(company.sectors.find((s) => s.id === first)?.removed).toBe(false);
    expect(company.sectors.find((s) => s.id === sector.id)?.removed).toBe(true);
    await expectDomainError(
      getCompany(handle.db, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );
  });
});

describe("company_list against SQL ground truth", () => {
  const CASES: { label: string; opts: ListCompaniesOptions }[] = [
    { label: "defaults", opts: {} },
    { label: "search name", opts: { search: "wren" } },
    { label: "search domain", opts: { search: "shared-fixture" } },
    { label: "search keyword", opts: { search: "clean beauty" } },
    { label: "search case-insensitive", opts: { search: "DUSK" } },
    { label: "country one", opts: { country: ["United States"] } },
    { label: "country two", opts: { country: ["Canada", "United Kingdom"] } },
    { label: "band 1-10", opts: { employeeBand: ["1-10"] } },
    { label: "band 11-50", opts: { employeeBand: ["11-50"] } },
    { label: "band 51-200", opts: { employeeBand: ["51-200"] } },
    { label: "band 201-500", opts: { employeeBand: ["201-500"] } },
    { label: "band 501+", opts: { employeeBand: ["501+"] } },
    { label: "bands multi", opts: { employeeBand: ["1-10", "501+"] } },
    { label: "industry", opts: { industry: ["cosmetics"] } },
    { label: "tech lowercase", opts: { technologiesAny: ["shopify"] } },
    { label: "tech multi", opts: { technologiesAny: ["Shopify", "yotpo"] } },
    { label: "funded", opts: { hasFunding: true } },
    { label: "unfunded", opts: { hasFunding: false } },
    { label: "shared", opts: { sharedDomain: true } },
    { label: "unshared", opts: { sharedDomain: false } },
    { label: "sort employees desc", opts: { sort: "employees", order: "desc" } },
    { label: "sort employees asc", opts: { sort: "employees", order: "asc" } },
    { label: "sort founded asc", opts: { sort: "founded", order: "asc" } },
    { label: "sort founded desc", opts: { sort: "founded", order: "desc" } },
    { label: "sort revenue desc", opts: { sort: "revenue", order: "desc" } },
    { label: "sort revenue asc", opts: { sort: "revenue", order: "asc" } },
    { label: "sort name desc", opts: { sort: "name", order: "desc" } },
    { label: "page two", opts: { page: 2, pageSize: 10 } },
    { label: "page small", opts: { page: 1, pageSize: 5, sort: "revenue", order: "desc" } },
    {
      label: "combined",
      opts: {
        search: "e",
        country: ["United States"],
        employeeBand: ["11-50", "51-200"],
        technologiesAny: ["shopify"],
        sort: "revenue",
        order: "desc",
        page: 1,
        pageSize: 7,
      },
    },
  ];

  for (const { label, opts } of CASES) {
    it(label, async () => {
      const sectorId = await seed();
      await expectMatchesTruth(sectorId, opts);
    });
  }

  it("includeRemoved shows the tombstoned row", async () => {
    const sectorId = await seed();
    const id = await companyIdByApollo(sectorId, "AP-1001");
    await removeCompany(handle.db, sectorId, id);
    await expectMatchesTruth(sectorId, { includeRemoved: true, pageSize: 200 });
    const live = await listCompanies(handle.db, sectorId, { pageSize: 200 });
    expect(live.total).toBe(27);
    const withRemoved = await listCompanies(handle.db, sectorId, {
      includeRemoved: true,
      pageSize: 200,
    });
    expect(withRemoved.total).toBe(28);
    expect(withRemoved.items.find((c) => c.id === id)?.removed).toBe(true);
  });

  it("pagination metadata is exact", async () => {
    const sectorId = await seed();
    const page = await listCompanies(handle.db, sectorId, { page: 3, pageSize: 10 });
    expect(page).toMatchObject({ total: 28, page: 3, pageSize: 10, totalPages: 3 });
    expect(page.items).toHaveLength(8);
  });

  it("returns slim rows under 30 KB per 50-page", async () => {
    const sectorId = await seed();
    const id = await companyIdByApollo(sectorId, "AP-1001");
    await updateCompany(handle.db, id, { name: "Owner Name" });
    const page = await listCompanies(handle.db, sectorId, { pageSize: 50 });
    expect(page.items.length).toBeGreaterThan(0);
    const keys = [
      "annualRevenue",
      "city",
      "country",
      "domain",
      "employees",
      "foundedYear",
      "hasOverrides",
      "id",
      "industry",
      "name",
      "removed",
      "sharedDomain",
      "source",
      "technologyCount",
      "totalFunding",
      "website",
    ];
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(keys);
    }
    const edited = page.items.find((c) => c.id === id);
    const plain = page.items.find((c) => c.id !== id);
    expect(edited?.name).toBe("Owner Name");
    expect(edited?.hasOverrides).toBe(true);
    expect(plain?.hasOverrides).toBe(false);
    expect(edited?.technologyCount).toBe(2);
    expect(JSON.stringify(page.items).length).toBeLessThan(30 * 1024);
  });

  it("filters match effective (overridden) values", async () => {
    const sectorId = await seed();
    const id = await companyIdByApollo(sectorId, "AP-1001");
    await updateCompany(handle.db, id, { name: "Zebra Override", technologies: ["Acme"] });
    const found = await listCompanies(handle.db, sectorId, { search: "zebra" });
    expect(found.items.map((c) => c.id)).toEqual([id]);
    const byTech = await listCompanies(handle.db, sectorId, { technologiesAny: ["acme"] });
    expect(byTech.items.map((c) => c.id)).toEqual([id]);
    expect(bandOf(8)).toBe("1-10");
  });

  it("validates list options", async () => {
    const sectorId = await seed();
    await expectDomainError(listCompanies(handle.db, sectorId, { pageSize: 201 }), "invalid_input");
    await expectDomainError(
      listCompanies(handle.db, sectorId, { sort: "nope" as CompanySort }),
      "invalid_input",
    );
    await expectDomainError(
      listCompanies(handle.db, sectorId, { employeeBand: ["huge" as EmployeeBand] }),
      "invalid_input",
    );
    await expectDomainError(
      listCompanies(handle.db, "00000000-0000-0000-0000-000000000000", {}),
      "not_found",
    );
  });
});

describe("company_facets against SQL ground truth", () => {
  it("matches counts per country, industry, band, and technology", async () => {
    const sectorId = await seed();
    const actual = await facets(handle.db, sectorId);

    const where = sql`m.sector_id = ${sectorId} AND m.removed_at IS NULL`;
    const countries = (await handle.db.execute(
      sql`SELECT c.country AS value, COUNT(*)::int AS count FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE ${where} AND c.country IS NOT NULL GROUP BY c.country ORDER BY count DESC, value`,
    )) as unknown as { value: string; count: number }[];
    const industries = (await handle.db.execute(
      sql`SELECT c.industry AS value, COUNT(*)::int AS count FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE ${where} AND c.industry IS NOT NULL GROUP BY c.industry ORDER BY count DESC, value`,
    )) as unknown as { value: string; count: number }[];
    const bands = (await handle.db.execute(
      sql`SELECT COUNT(*) FILTER (WHERE c.employees BETWEEN 1 AND 10)::int AS b1, COUNT(*) FILTER (WHERE c.employees BETWEEN 11 AND 50)::int AS b2, COUNT(*) FILTER (WHERE c.employees BETWEEN 51 AND 200)::int AS b3, COUNT(*) FILTER (WHERE c.employees BETWEEN 201 AND 500)::int AS b4, COUNT(*) FILTER (WHERE c.employees >= 501)::int AS b5 FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE ${where}`,
    )) as unknown as { b1: number; b2: number; b3: number; b4: number; b5: number }[];
    const techs = (await handle.db.execute(
      sql`SELECT t AS value, COUNT(*)::int AS count FROM (SELECT unnest(c.technologies) AS t FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE ${where}) AS s GROUP BY t ORDER BY count DESC, t LIMIT 50`,
    )) as unknown as { value: string; count: number }[];

    expect(actual.countries).toEqual(countries);
    expect(actual.industries).toEqual(industries);
    const row = bands[0];
    if (!row) throw new Error("no band row");
    expect(actual.employeeBands).toEqual([
      { band: "1-10", count: row.b1 },
      { band: "11-50", count: row.b2 },
      { band: "51-200", count: row.b3 },
      { band: "201-500", count: row.b4 },
      { band: "501+", count: row.b5 },
    ]);
    expect(actual.technologies).toEqual(techs);
  });

  it("missing sector is not_found", async () => {
    await expectDomainError(
      facets(handle.db, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );
  });
});
