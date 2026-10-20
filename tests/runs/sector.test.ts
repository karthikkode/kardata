import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { researchRuns, sectorCompanies } from "../../src/db/schema.js";
import { DomainError } from "../../src/domain/errors.js";
import { createSector } from "../../src/domain/sectors.js";
import { removeCompany } from "../../src/domain/companies.js";
import { createJobRunner, jobStatus, startCollectSectorJob } from "../../src/runs/bulk.js";
import { startCollect } from "../../src/runs/queue.js";
import { harnessSettingsSet } from "../../src/runs/settings.js";
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

/** Fake collect starter: real research_runs rows (run_id is an FK), no runner. */
function fakeCollectStarter(started: string[]) {
  return async (companyId: string) => {
    const runId = randomUUID();
    await handle.db.insert(researchRuns).values({ id: runId, companyId, kind: "collect", status: "running" });
    started.push(companyId);
    return { runId };
  };
}

describe("collect_sector job", () => {
  it("creates one queued item per live company and queues nothing eagerly", async () => {
    const { sectorId, ids } = await seedSectorWith(210);
    const result = await startCollectSectorJob(handle.db, { sectorId });
    expect(result.items).toBe(210);
    const view = await jobStatus(handle.db, result.jobId);
    expect(view.job.kind).toBe("collect");
    expect(view.counts).toMatchObject({ queued: 210 });
    expect(view.items).toHaveLength(200);
    expect(view.itemsTruncated).toBe(true);
    const idSet = new Set(ids);
    for (const item of view.items) expect(idSet.has(item.companyId)).toBe(true);
    expect(await handle.db.select().from(researchRuns)).toHaveLength(0);
  });

  it("leaves busy companies queued at feed time", async () => {
    const { sectorId, ids } = await seedSectorWith(3);
    await startCollect(handle.db, ids);
    await harnessSettingsSet(handle.db, 3);
    const started: string[] = [];
    const runner = createJobRunner(handle.db, {
      startResearch: async () => ({ busy: true }),
      startCollect: async (companyId) => {
        const result = await startCollect(handle.db, [companyId]);
        const entry = result.runs[0];
        if (!entry || entry.status === "already_running") return { busy: true };
        started.push(companyId);
        return { runId: entry.runId };
      },
      extract: async () => {},
    });
    const { jobId } = await startCollectSectorJob(handle.db, { sectorId, onlyStale: false });
    await runner.tick();
    expect(started).toHaveLength(0);
    const view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ queued: 3 });
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
    await harnessSettingsSet(handle.db, 4);
    const started: string[] = [];
    const runner = createJobRunner(handle.db, {
      startResearch: async () => ({ busy: true }),
      startCollect: fakeCollectStarter(started),
      extract: async () => {},
    });
    const { jobId } = await startCollectSectorJob(handle.db, { sectorId });
    await runner.tick();
    expect(started.sort()).toEqual([ids[1], ids[3]].sort());
    const view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ skipped: 2, running: 2 });
  });

  it("honors onlyStale=false and a custom window", async () => {
    const { sectorId, ids } = await seedSectorWith(2);
    await finishCollect(ids[0] as string, 5, "succeeded");
    await harnessSettingsSet(handle.db, 2);
    const started: string[] = [];
    const runner = createJobRunner(handle.db, {
      startResearch: async () => ({ busy: true }),
      startCollect: fakeCollectStarter(started),
      extract: async () => {},
    });
    const all = await startCollectSectorJob(handle.db, { sectorId, onlyStale: false });
    await runner.tick();
    expect(started).toHaveLength(2);
    const allView = await jobStatus(handle.db, all.jobId);
    expect(allView.counts.skipped).toBe(0);
    await handle.db.delete(researchRuns);
    started.length = 0;
    const narrow = await startCollectSectorJob(handle.db, { sectorId, staleDays: 3 });
    await runner.tick();
    expect(started).toHaveLength(2);
    const narrowView = await jobStatus(handle.db, narrow.jobId);
    expect(narrowView.counts.skipped).toBe(0);
  });

  it("excludes removed members", async () => {
    const { sectorId, ids } = await seedSectorWith(3);
    await removeCompany(handle.db, sectorId, ids[0] as string);
    const result = await startCollectSectorJob(handle.db, { sectorId });
    expect(result.items).toBe(2);
  });

  it("rejects unknown sectors and bad windows", async () => {
    const { sectorId } = await seedSectorWith(1);
    await expect(startCollectSectorJob(handle.db, { sectorId: randomUUID() })).rejects.toBeInstanceOf(DomainError);
    await expect(startCollectSectorJob(handle.db, { sectorId, staleDays: -1 })).rejects.toBeInstanceOf(DomainError);
  });
});
