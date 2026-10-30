import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { importSec } from "../../src/domain/imports.js";
import { deriveCompany, setOverride } from "../../src/domain/sector-preflight/eligibility.js";
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;
const fixture = join(process.cwd(), "tests/fixtures/sec-sample.csv");

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

async function companyIdByCrd(crd: string): Promise<string> {
  const rows = (await handle.db.execute(sql`SELECT id FROM companies WHERE sec_crd = ${crd}`)) as unknown as { id: string }[];
  if (!rows[0]) throw new Error(`missing company ${crd}`);
  return rows[0].id;
}

describe("RIA rule preflight", () => {
  it("derives groups and reasons from imported facts, override wins", async () => {
    const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
    const { sector } = await createSector(handle.db, { name: "ria-b3", profile });
    await importSec(handle.db, sector.id, fixture, { importDirs: fixtureImportDirs() });
    const p = await companyIdByCrd("900001");
    const r = await companyIdByCrd("900002");
    const large = await companyIdByCrd("900003");
    expect(await deriveCompany(handle.db, sector.id, p)).toMatchObject({ eligibility: "eligible", reason: "group:P" });
    expect(await deriveCompany(handle.db, sector.id, r)).toMatchObject({ eligibility: "eligible", reason: "group:R" });
    expect(await deriveCompany(handle.db, sector.id, large)).toMatchObject({ eligibility: "ineligible", reason: "large" });
    const overridden = await setOverride(handle.db, sector.id, p, "exclude", "owner call");
    expect(overridden.eligibility).toBe("ineligible");
    const cleared = await setOverride(handle.db, sector.id, p, "clear");
    expect(cleared).toMatchObject({ eligibility: "eligible", reason: "group:P" });
  });
});
