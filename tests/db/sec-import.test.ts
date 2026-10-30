import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { facts, factsCurrent, sources } from "../../src/db/schema.js";
import { importSec } from "../../src/domain/imports.js";
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;
const DIRS = fixtureImportDirs();
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

describe("SEC adviser import", () => {
  it("creates companies keyed by CRD with firm facts", async () => {
    const { sector } = await createSector(handle.db, { name: "ria-test" });
    const result = await importSec(handle.db, sector.id, fixture, { importDirs: DIRS });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("import failed");
    expect(result.import.createdCount).toBe(3);
    expect(result.import.skippedCount).toBe(1);
    const current = await handle.db.select().from(factsCurrent);
    const aum = current.filter((f) => f.key === "firm.regulatory_aum");
    expect(aum).toHaveLength(3);
    const secSources = await handle.db.select().from(sources).where(eq(sources.collector, "sec_import"));
    expect(secSources).toHaveLength(3);
  });

  it("re-import updates and keeps fact history", async () => {
    const { sector } = await createSector(handle.db, { name: "ria-test-2" });
    await importSec(handle.db, sector.id, fixture, { importDirs: DIRS });
    const again = await importSec(handle.db, sector.id, fixture, { importDirs: DIRS });
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("import failed");
    expect(again.import.createdCount).toBe(0);
    expect(again.import.updatedCount).toBe(3);
    const all = await handle.db.select().from(facts);
    const aumHistory = all.filter((f) => f.key === "firm.regulatory_aum");
    expect(aumHistory).toHaveLength(6);
  });
});
