import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { blobs, companies, researchRuns, sources } from "../../src/db/schema.js";
import { importCsv } from "../../src/domain/imports.js";
import { createSector } from "../../src/domain/sectors.js";
import { backfillApolloImportSources } from "../../src/domain/research/sources.js";
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

async function importFixture(): Promise<{ sectorId: string; importId: string }> {
  const { sector } = await createSector(handle.db, { name: "Skincare" });
  const [result] = await importCsv(handle.db, sector.id, [fixtureCsvPath()], { importDirs: DIRS });
  if (!result || !result.ok) throw new Error("import failed");
  return { sectorId: sector.id, importId: result.import.id };
}

describe("apollo import source backfill", () => {
  it("fills pre-2.1 companies, reuses manual runs, and is idempotent", async () => {
    const { importId } = await importFixture();
    // Simulate the pre-2.1 state: Apollo companies with no import sources.
    await handle.db.execute(sql`DELETE FROM sources WHERE collector = 'apollo_import'`);
    const [manual] = await handle.db
      .insert(companies)
      .values({ id: randomUUID(), source: "manual", name: "Manual Co" })
      .returning({ id: companies.id });
    if (!manual) throw new Error("no manual company");

    const first = await backfillApolloImportSources(handle.db);
    expect(first).toEqual({ created: 28, alreadyHad: 0, skippedNoImport: 0 });

    const apollo = await handle.db.select().from(sources).where(eq(sources.collector, "apollo_import"));
    expect(apollo).toHaveLength(28);
    expect(apollo.every((s) => s.url.startsWith(`apollo:import/${importId}/`))).toBe(true);
    expect(apollo.every((s) => s.status === "ok")).toBe(true);
    expect(apollo.some((s) => s.companyId === manual.id)).toBe(false);
    const one = apollo[0];
    if (!one?.blobSha256) throw new Error("missing apollo source blob");
    const [blob] = await handle.db.select().from(blobs).where(eq(blobs.sha256, one.blobSha256));
    if (!blob) throw new Error("missing blob row");
    const [company] = await handle.db.select().from(companies).where(eq(companies.id, one.companyId));
    expect(JSON.parse(gunzipSync(blob.gzip).toString("utf8"))).toEqual(company?.raw);

    const manualRuns = await handle.db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.kind, "manual"));
    expect(manualRuns).toHaveLength(28);
    expect(manualRuns.every((r) => r.status === "succeeded" && r.createdBy === "owner")).toBe(true);

    const second = await backfillApolloImportSources(handle.db);
    expect(second).toEqual({ created: 0, alreadyHad: 28, skippedNoImport: 0 });
  });

  it("skips Apollo companies with no import link", async () => {
    await importFixture();
    await handle.db.execute(sql`DELETE FROM sources WHERE collector = 'apollo_import'`);
    await handle.db.execute(sql`
      DELETE FROM sector_companies WHERE company_id =
        (SELECT id FROM companies WHERE apollo_account_id = 'AP-1005')`);
    const result = await backfillApolloImportSources(handle.db);
    expect(result).toEqual({ created: 27, alreadyHad: 0, skippedNoImport: 1 });
  });
});
