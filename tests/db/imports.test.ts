import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  getCompany,
  listCompanies,
  removeCompany,
  restoreCompany,
  updateCompany,
} from "../../src/domain/companies.js";
import { DomainError } from "../../src/domain/errors.js";
import { importCsv, listImports } from "../../src/domain/imports.js";
import { createSector } from "../../src/domain/sectors.js";
import {
  badHeadersCsvPath,
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

async function makeSector(name = "Skincare"): Promise<string> {
  const { sector } = await createSector(handle.db, { name });
  return sector.id;
}

async function companyIdByApollo(sectorId: string, apolloId: string): Promise<string> {
  const rows = (await handle.db.execute(
    sql`SELECT c.id AS id FROM companies AS c JOIN sector_companies AS m ON m.company_id = c.id WHERE m.sector_id = ${sectorId} AND c.apollo_account_id = ${apolloId}`,
  )) as unknown as { id: string }[];
  if (!rows[0]) throw new Error(`missing company ${apolloId}`);
  return rows[0].id;
}

describe("csv imports", () => {
  it("reports exact fixture counts", async () => {
    const sectorId = await makeSector();
    const [result] = await importCsv(handle.db, sectorId, [fixtureCsvPath()], {
      importDirs: DIRS,
    });
    expect(result?.ok).toBe(true);
    if (!result || !result.ok) throw new Error("import failed");
    expect(result.import.filename).toBe("apollo-sample.csv");
    expect(result.import.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.import.rowsRead).toBe(30);
    expect(result.import.createdCount).toBe(28);
    expect(result.import.linkedCount).toBe(0);
    expect(result.import.updatedCount).toBe(0);
    expect(result.import.skippedCount).toBe(1);
    expect(result.import.skipped).toEqual([{ row: 11, reason: "missing apollo id" }]);
  });

  it("last row wins for a repeated id", async () => {
    const sectorId = await makeSector();
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    const id = await companyIdByApollo(sectorId, "AP-1007");
    const company = await getCompany(handle.db, id);
    expect(company.name).toBe("Duplicate Second");
    expect(company.employees).toBe(55);
  });

  it("re-importing updates without changing the count", async () => {
    const sectorId = await makeSector();
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    const [result] = await importCsv(handle.db, sectorId, [fixtureCsvPath()], {
      importDirs: DIRS,
    });
    if (!result || !result.ok) throw new Error("import failed");
    expect(result.import.createdCount).toBe(0);
    expect(result.import.updatedCount).toBe(28);
    expect(result.import.linkedCount).toBe(0);
    const listed = await listCompanies(handle.db, sectorId, { pageSize: 200 });
    expect(listed.total).toBe(28);
  });

  it("importing into a second sector links instead of creating", async () => {
    const first = await makeSector("First");
    const second = await makeSector("Second");
    await importCsv(handle.db, first, [fixtureCsvPath()], { importDirs: DIRS });
    const [result] = await importCsv(handle.db, second, [fixtureCsvPath()], {
      importDirs: DIRS,
    });
    if (!result || !result.ok) throw new Error("import failed");
    expect(result.import.createdCount).toBe(0);
    expect(result.import.linkedCount).toBe(28);
    const listed = await listCompanies(handle.db, second, { pageSize: 200 });
    expect(listed.total).toBe(28);
  });

  it("never revives a tombstoned company, until restore", async () => {
    const sectorId = await makeSector();
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    const id = await companyIdByApollo(sectorId, "AP-1005");
    await removeCompany(handle.db, sectorId, id);
    const [result] = await importCsv(handle.db, sectorId, [fixtureCsvPath()], {
      importDirs: DIRS,
    });
    if (!result || !result.ok) throw new Error("import failed");
    expect(result.import.updatedCount).toBe(27);
    expect(result.import.skippedCount).toBe(2);
    expect(result.import.skipped).toContainEqual({ row: 5, reason: "removed by owner" });
    expect((await listCompanies(handle.db, sectorId, { pageSize: 200 })).total).toBe(27);
    await restoreCompany(handle.db, sectorId, id);
    expect((await listCompanies(handle.db, sectorId, { pageSize: 200 })).total).toBe(28);
  });

  it("keeps owner overrides across a re-import", async () => {
    const sectorId = await makeSector();
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    const id = await companyIdByApollo(sectorId, "AP-1005");
    await updateCompany(handle.db, id, { name: "Owner Name" });
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    const company = await getCompany(handle.db, id);
    expect(company.name).toBe("Owner Name");
    expect(company.overrides).toMatchObject({ name: "Owner Name" });
    expect(company.raw["Company Name"]).toBe("Shared Domain A");
    const cleared = await updateCompany(handle.db, id, { name: null });
    expect(cleared.name).toBe("Shared Domain A");
  });

  it("flags shared_domain on exactly the shared rows", async () => {
    const sectorId = await makeSector();
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    const shared = await listCompanies(handle.db, sectorId, {
      sharedDomain: true,
      pageSize: 200,
    });
    const want = new Set([
      await companyIdByApollo(sectorId, "AP-1005"),
      await companyIdByApollo(sectorId, "AP-1006"),
    ]);
    expect(new Set(shared.items.map((c) => c.id))).toEqual(want);
    const unshared = await listCompanies(handle.db, sectorId, {
      sharedDomain: false,
      pageSize: 200,
    });
    expect(unshared.total).toBe(26);
  });

  it("a bad-header file writes nothing", async () => {
    const sectorId = await makeSector();
    const [result] = await importCsv(handle.db, sectorId, [badHeadersCsvPath()], {
      importDirs: DIRS,
    });
    expect(result?.ok).toBe(false);
    if (!result || result.ok) throw new Error("expected a failure result");
    expect(result.error.code).toBe("file_error");
    expect(await listImports(handle.db, sectorId)).toEqual([]);
    expect((await listCompanies(handle.db, sectorId, { pageSize: 200 })).total).toBe(0);
  });

  it("rejects paths outside the import dirs", async () => {
    const sectorId = await makeSector();
    await expectDomainError(
      importCsv(handle.db, sectorId, ["/etc/hosts"], { importDirs: DIRS }),
      "invalid_input",
    );
    await expectDomainError(
      importCsv(handle.db, sectorId, [join(DIRS[0] ?? "", "..", "db", "migrate.test.ts")], {
        importDirs: DIRS,
      }),
      "invalid_input",
    );
  });

  it("rejects symlink escapes but follows in-jail links", async () => {
    const scratch = join(tmpdir(), "kardata-jail-test");
    await mkdir(scratch, { recursive: true });
    try {
      const escape = join(scratch, "escape.csv");
      const inside = join(scratch, "inside.csv");
      await rm(escape, { force: true });
      await rm(inside, { force: true });
      await symlink("/etc/hosts", escape);
      await symlink(fixtureCsvPath(), inside);
      const sectorId = await makeSector();
      await expectDomainError(
        importCsv(handle.db, sectorId, [escape], { importDirs: [scratch] }),
        "invalid_input",
      );
      const [result] = await importCsv(handle.db, sectorId, [inside], {
        importDirs: [scratch, ...DIRS],
      });
      expect(result?.ok).toBe(true);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("rejects empty, oversized-batch, missing, and oversized files", async () => {
    const sectorId = await makeSector();
    await expectDomainError(importCsv(handle.db, sectorId, [], { importDirs: DIRS }), "invalid_input");
    await expectDomainError(
      importCsv(handle.db, sectorId, Array.from({ length: 11 }, () => fixtureCsvPath()), {
        importDirs: DIRS,
      }),
      "invalid_input",
    );
    await expectDomainError(
      importCsv(handle.db, sectorId, [join(DIRS[0] ?? "", "nope.csv")], { importDirs: DIRS }),
      "file_error",
    );
    const scratch = join(tmpdir(), "kardata-size-test");
    await mkdir(scratch, { recursive: true });
    try {
      const big = join(scratch, "big.csv");
      await writeFile(big, "x".repeat(26 * 1024 * 1024));
      await expectDomainError(importCsv(handle.db, sectorId, [big], { importDirs: [scratch] }), "invalid_input");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("import into a missing sector is not_found", async () => {
    await expectDomainError(
      importCsv(handle.db, "00000000-0000-0000-0000-000000000000", [fixtureCsvPath()], {
        importDirs: DIRS,
      }),
      "not_found",
    );
  });

  it("lists imports newest first", async () => {
    const sectorId = await makeSector();
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    await importCsv(handle.db, sectorId, [fixtureCsvPath()], { importDirs: DIRS });
    const rows = await listImports(handle.db, sectorId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(rows[1]?.createdAt.getTime() ?? 0);
    await expectDomainError(
      listImports(handle.db, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );
  });
});
