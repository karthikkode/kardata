import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { runRiaStep, setRiaStepPaused } from "../../src/domain/ria-steps/runner.js";
import { importSec } from "../../src/domain/imports.js";
import { deriveCompany } from "../../src/domain/sector-preflight/eligibility.js";
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;
beforeAll(async () => { handle = getTestDb(); await ensureMigrated(handle); });
beforeEach(async () => { await resetTestDb(handle); await setRiaStepPaused(handle.db, false); });
afterAll(async () => { await handle.close(); });

describe("RIA step runner (B2)", () => {
  it("runs a fake handler over eligible firms and skips done on re-run", async () => {
    const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
    const { sector } = await createSector(handle.db, { name: "ria-b2", profile });
    await importSec(handle.db, sector.id, join(process.cwd(), "tests/fixtures/sec-sample.csv"), { importDirs: fixtureImportDirs() });
    const rows = (await handle.db.execute(sql`SELECT id FROM companies`)) as unknown as { id: string }[];
    for (const r of rows) await deriveCompany(handle.db, sector.id, r.id);
    const handlers = { firm_data: async () => ({ status: "done" as const }) };
    const first = await runRiaStep(handle.db, { sectorId: sector.id, step: "firm_data" }, handlers);
    expect(first.done).toBe(2);
    const second = await runRiaStep(handle.db, { sectorId: sector.id, step: "firm_data" }, handlers);
    expect(second.skippedDone).toBe(2);
    await setRiaStepPaused(handle.db, true);
    const third = await runRiaStep(handle.db, { sectorId: sector.id, step: "firm_data", companyIds: [rows[0]?.id as string] }, handlers);
    expect(third.stopped).toBe("pause");
  });
});
