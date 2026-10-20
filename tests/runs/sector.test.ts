import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { researchRuns, sectorCompanies } from "../../src/db/schema.js";
import { DomainError } from "../../src/domain/errors.js";
import { createSector } from "../../src/domain/sectors.js";
import { removeCompany } from "../../src/domain/companies.js";
import { startCollectSector } from "../../src/runs/queue.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { seedCompany } from "../collect/helpers.js";

let handle: DbHandle;

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

async function seedSectorWith(n: number, name = "Sector"): Promise<{ sectorId: string; ids: string[] }> {
  const { sector } = await createSector(handle.db, { name });
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = await seedCompany(handle.db, { name: `Co ${i}` });
    await handle.db.insert(sectorCompanies).values({ sectorId: sector.id, companyId: id, addedVia: "manual" });
    ids.push(id);
  }
  return { sectorId: sector.id, ids };
}

async function finishCollect(companyId: string, daysAgo: number, status: "succeeded" | "partial"): Promise<void> {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  await handle.db.insert(researchRuns).values({
    id: randomUUID(),
    companyId,
    kind: "collect",
    status,
    startedAt: at,
    finishedAt: at,
  });
}

describe("collect_sector", () => {
  it("queues every live company in batches of 100", async () => {
    const { sectorId, ids } = await seedSectorWith(210);
    const result = await startCollectSector(handle.db, { sectorId });
    expect(result.batchIds).toHaveLength(3);
    expect(new Set(result.batchIds).size).toBe(3);
    expect(result.queued).toBe(210);
    expect(result.alreadyRunning).toBe(0);
    expect(result.skippedFresh).toBe(0);
    const runs = await handle.db.select().from(researchRuns);
    expect(runs).toHaveLength(210);
    expect(new Set(runs.map((r) => r.companyId))).toEqual(new Set(ids));
  });

  it("reports already-running on the second call", async () => {
    const { sectorId } = await seedSectorWith(3);
    await startCollectSector(handle.db, { sectorId });
    const again = await startCollectSector(handle.db, { sectorId });
    expect(again.queued).toBe(0);
    expect(again.alreadyRunning).toBe(3);
  });

  it("skips fresh collects by default", async () => {
    const { sectorId, ids } = await seedSectorWith(4);
    await finishCollect(ids[0] as string, 1, "succeeded");
    await finishCollect(ids[1] as string, 20, "succeeded");
    await finishCollect(ids[2] as string, 1, "partial");
    await handle.db.insert(researchRuns).values({
      id: randomUUID(),
      companyId: ids[3],
      kind: "agent",
      status: "succeeded",
      finishedAt: new Date(),
    });
    const result = await startCollectSector(handle.db, { sectorId });
    expect(result.queued).toBe(2);
    expect(result.skippedFresh).toBe(2);
    const queued = await handle.db
      .select({ companyId: researchRuns.companyId })
      .from(researchRuns)
      .where(eq(researchRuns.status, "queued"));
    expect(queued.map((r) => r.companyId).sort()).toEqual([ids[1], ids[3]].sort());
  });

  it("honors onlyStale=false and a custom window", async () => {
    const { sectorId, ids } = await seedSectorWith(2);
    await finishCollect(ids[0] as string, 5, "succeeded");
    const all = await startCollectSector(handle.db, { sectorId, onlyStale: false });
    expect(all.queued).toBe(2);
    expect(all.skippedFresh).toBe(0);
    await handle.db.delete(researchRuns);
    const narrow = await startCollectSector(handle.db, { sectorId, staleDays: 3 });
    expect(narrow.queued).toBe(2);
    expect(narrow.skippedFresh).toBe(0);
  });

  it("excludes removed members", async () => {
    const { sectorId, ids } = await seedSectorWith(3);
    await removeCompany(handle.db, sectorId, ids[0] as string);
    const result = await startCollectSector(handle.db, { sectorId });
    expect(result.queued).toBe(2);
  });

  it("rejects unknown sectors and bad windows", async () => {
    const { sectorId } = await seedSectorWith(1);
    await expect(startCollectSector(handle.db, { sectorId: randomUUID() })).rejects.toBeInstanceOf(DomainError);
    await expect(startCollectSector(handle.db, { sectorId, staleDays: -1 })).rejects.toBeInstanceOf(DomainError);
  });
});
