import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { queueRiaDeepResearch } from "../../src/domain/ria-steps/deep-research.js";
import { importSec } from "../../src/domain/imports.js";
import { deriveCompany } from "../../src/domain/sector-preflight/eligibility.js";
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;
const fixture = join(process.cwd(), "tests/fixtures/sec-sample.csv");
beforeAll(async () => { handle = getTestDb(); await ensureMigrated(handle); });
beforeEach(async () => { await resetTestDb(handle); });
afterAll(async () => { await handle.close(); });

async function eligibleSector(): Promise<{ sectorId: string; ids: string[] }> {
  const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
  const { sector } = await createSector(handle.db, { name: "ria-b8", profile });
  await importSec(handle.db, sector.id, fixture, { importDirs: fixtureImportDirs() });
  const rows = (await handle.db.execute(sql`SELECT id FROM companies`)) as unknown as { id: string }[];
  const ids: string[] = [];
  for (const r of rows) {
    const triple = await deriveCompany(handle.db, sector.id, r.id);
    if (triple.eligibility === "eligible") ids.push(r.id);
  }
  return { sectorId: sector.id, ids };
}

describe("RIA deep research opt-in (B8)", () => {
  it("queues jobs only for named eligible firms", async () => {
    const { sectorId, ids } = await eligibleSector();
    expect(ids.length).toBeGreaterThan(0);
    const out = await queueRiaDeepResearch(handle.db, { sectorId, companyIds: [ids[0] as string, "00000000-0000-0000-0000-000000000000"] });
    expect(out.queued).toHaveLength(1);
    expect(out.rejected).toEqual([{ companyId: "00000000-0000-0000-0000-000000000000", reason: "not an eligible member of the sector" }]);
    const jobs = (await handle.db.execute(sql`SELECT status FROM company_jobs WHERE company_id = ${ids[0] as string}`)) as unknown as { status: string }[];
    expect(jobs).toHaveLength(1);
  });

  it("refuses an empty named list", async () => {
    const { sectorId } = await eligibleSector();
    await expect(queueRiaDeepResearch(handle.db, { sectorId, companyIds: [] })).rejects.toThrow("named list");
  });
});
