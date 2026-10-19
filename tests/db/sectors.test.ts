import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { getCompany, listCompanies, removeCompany } from "../../src/domain/companies.js";
import { DomainError } from "../../src/domain/errors.js";
import {
  createSector,
  deleteSector,
  getSector,
  listSectors,
  updateSector,
} from "../../src/domain/sectors.js";
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

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return err as Error;
  }
  throw new Error(`expected DomainError ${code}, but the call succeeded`);
}

describe("sectors", () => {
  it("creates a sector with defaults", async () => {
    const { sector, imports } = await createSector(handle.db, { name: "Skincare" });
    expect(sector.name).toBe("Skincare");
    expect(sector.description).toBe("");
    expect(sector.companyCount).toBe(0);
    expect(sector.removedCount).toBe(0);
    expect(imports).toEqual([]);
  });

  it("rejects duplicate names case-insensitively", async () => {
    await createSector(handle.db, { name: "Skincare" });
    await expectDomainError(createSector(handle.db, { name: "SKINCARE" }), "conflict");
  });

  it("rejects an empty name", async () => {
    await expectDomainError(createSector(handle.db, { name: "   " }), "invalid_input");
  });

  it("imports csvPaths on creation", async () => {
    const { sector, imports } = await createSector(
      handle.db,
      { name: "Skincare", description: "test", csvPaths: [fixtureCsvPath()] },
      { importDirs: DIRS },
    );
    expect(sector.description).toBe("test");
    expect(sector.companyCount).toBe(28);
    expect(imports).toHaveLength(1);
    expect(imports[0]?.ok).toBe(true);
  });

  it("creates nothing when every file fails", async () => {
    await expectDomainError(
      createSector(
        handle.db,
        { name: "Skincare", csvPaths: [badHeadersCsvPath()] },
        { importDirs: DIRS },
      ),
      "file_error",
    );
    expect(await listSectors(handle.db)).toEqual([]);
  });

  it("keeps partial success when only some files fail", async () => {
    const { sector, imports } = await createSector(
      handle.db,
      { name: "Skincare", csvPaths: [badHeadersCsvPath(), fixtureCsvPath()] },
      { importDirs: DIRS },
    );
    expect(imports.map((r) => r.ok)).toEqual([false, true]);
    expect(sector.companyCount).toBe(28);
  });

  it("updates name and description", async () => {
    const { sector } = await createSector(handle.db, { name: "Old" });
    const updated = await updateSector(handle.db, sector.id, {
      name: "New",
      description: "d",
    });
    expect(updated.name).toBe("New");
    expect(updated.description).toBe("d");
  });

  it("rejects renames that collide", async () => {
    const a = await createSector(handle.db, { name: "Alpha" });
    await createSector(handle.db, { name: "Beta" });
    await expectDomainError(updateSector(handle.db, a.sector.id, { name: "beta" }), "conflict");
  });

  it("update of a missing sector is not_found", async () => {
    await expectDomainError(
      updateSector(handle.db, "00000000-0000-0000-0000-000000000000", { name: "x" }),
      "not_found",
    );
  });

  it("delete requires an exact confirm_name", async () => {
    const { sector } = await createSector(handle.db, { name: "Skincare" });
    await expectDomainError(deleteSector(handle.db, sector.id, "skincare"), "invalid_input");
    expect((await getSector(handle.db, sector.id)).name).toBe("Skincare");
  });

  it("delete removes memberships and imports but keeps global companies", async () => {
    const { sector } = await createSector(
      handle.db,
      { name: "Skincare", csvPaths: [fixtureCsvPath()] },
      { importDirs: DIRS },
    );
    const listed = await listCompanies(handle.db, sector.id, { pageSize: 200 });
    const companyId = listed.items[0]?.id;
    if (!companyId) throw new Error("fixture import is empty");
    const deleted = await deleteSector(handle.db, sector.id, "Skincare");
    expect(deleted).toEqual({ id: sector.id, name: "Skincare" });
    await expectDomainError(getSector(handle.db, sector.id), "not_found");
    expect(await listSectors(handle.db)).toEqual([]);
    const stillThere = await getCompany(handle.db, companyId);
    expect(stillThere.sectors).toEqual([]);
  });

  it("delete of a missing sector is not_found", async () => {
    await expectDomainError(
      deleteSector(handle.db, "00000000-0000-0000-0000-000000000000", "x"),
      "not_found",
    );
  });

  it("lists sectors with live and removed counts, ordered by name", async () => {
    await createSector(handle.db, { name: "Beta" });
    const { sector } = await createSector(
      handle.db,
      { name: "Alpha", csvPaths: [fixtureCsvPath()] },
      { importDirs: DIRS },
    );
    const listed = await listCompanies(handle.db, sector.id, { pageSize: 200 });
    await removeCompany(handle.db, sector.id, listed.items[0]?.id ?? "");
    const sectors = await listSectors(handle.db);
    expect(sectors.map((s) => s.name)).toEqual(["Alpha", "Beta"]);
    expect(sectors[0]).toMatchObject({ companyCount: 27, removedCount: 1 });
    expect(sectors[1]).toMatchObject({ companyCount: 0, removedCount: 0 });
  });

  it("getSector carries the last imports", async () => {
    const { sector } = await createSector(
      handle.db,
      { name: "Skincare", csvPaths: [fixtureCsvPath()] },
      { importDirs: DIRS },
    );
    const full = await getSector(handle.db, sector.id);
    expect(full.companyCount).toBe(28);
    expect(full.imports).toHaveLength(1);
    expect(full.imports[0]?.filename).toBe("apollo-sample.csv");
  });

  it("getSector of a missing sector is not_found", async () => {
    await expectDomainError(
      getSector(handle.db, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );
  });
});
