import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { researchRuns } from "../../src/db/schema.js";
import { executeCollectRun } from "../../src/collect/run.js";
import { cancelRun, startCollect } from "../../src/runs/queue.js";
import { createRunner } from "../../src/runs/runner.js";
import { startCompanyJob } from "../../src/runs/company.js";
import { DomainError } from "../../src/domain/errors.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import {
  restoreHostDelay,
  seedCompany,
  seedRun,
  shrinkHostDelay,
} from "../collect/helpers.js";
import { sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
});

beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) =>
    sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"),
  );
});

afterEach(async () => {
  await site.close();
});

afterAll(async () => {
  restoreHostDelay(delayPrev);
  await handle.close();
});

async function runStatus(runId: string): Promise<string | undefined> {
  const [row] = await handle.db
    .select({ status: researchRuns.status })
    .from(researchRuns)
    .where(eq(researchRuns.id, runId));
  return row?.status;
}

describe("startCollect", () => {
  it("creates one queued run per company under a batch id", async () => {
    const a = await seedCompany(handle.db, { name: "A Co" });
    const b = await seedCompany(handle.db, { name: "B Co" });
    const batch = await startCollect(handle.db, [a, b], ["hiring"]);
    expect(batch.runs).toHaveLength(2);
    expect(batch.runs.every((r) => r.status === "queued")).toBe(true);
    const rows = await handle.db.select().from(researchRuns);
    expect(rows.every((r) => r.batchId === batch.batchId)).toBe(true);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
    expect(rows[0]?.requestedAreas).toEqual(["hiring"]);
  });

  it("reports already_running instead of queuing twice", async () => {
    const a = await seedCompany(handle.db, { name: "A Co" });
    const first = await startCollect(handle.db, [a]);
    const firstId = first.runs[0]?.runId;
    const second = await startCollect(handle.db, [a]);
    expect(second.runs).toEqual([{ companyId: a, runId: firstId, status: "already_running" }]);
    await handle.db.update(researchRuns).set({ status: "running" }).where(eq(researchRuns.id, firstId ?? ""));
    const third = await startCollect(handle.db, [a]);
    expect(third.runs).toEqual([{ companyId: a, runId: firstId, status: "already_running" }]);
    expect(await handle.db.select().from(researchRuns)).toHaveLength(1);
  });

  it("validates its input", async () => {
    const a = await seedCompany(handle.db, { name: "A Co" });
    await expect(startCollect(handle.db, [])).rejects.toThrow(DomainError);
    await expect(startCollect(handle.db, Array.from({ length: 101 }, () => a))).rejects.toThrow(/at most 100/);
    await expect(startCollect(handle.db, [randomUUID()])).rejects.toThrow(/unknown companies/);
    await expect(startCollect(handle.db, [a], ["nope"])).rejects.toThrow(/unknown area/);
  });
});

describe("cancelRun", () => {
  it("cancels queued and running runs, leaves finished ones alone", async () => {
    const a = await seedCompany(handle.db, { name: "A Co" });
    const queued = await seedRun(handle.db, a);
    await handle.db.update(researchRuns).set({ status: "queued" }).where(eq(researchRuns.id, queued));
    const cancelled = await cancelRun(handle.db, queued);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.finishedAt).not.toBeNull();

    const done = await seedRun(handle.db, await seedCompany(handle.db, { name: "B Co" }));
    await handle.db.update(researchRuns).set({ status: "succeeded" }).where(eq(researchRuns.id, done));
    expect((await cancelRun(handle.db, done)).status).toBe("succeeded");
    await expect(cancelRun(handle.db, randomUUID())).rejects.toThrow(/run not found/);
  });

  it("stops a running collect before its next fetch", async () => {
    site.routes.set("/", (_req, res) => {
      setTimeout(() => sendText(res, "<html><head><title>Slow</title></head><body>Hi</body></html>"), 500);
    });
    const companyId = await seedCompany(handle.db, { name: "Slow Co", website: site.baseUrl });
    const runId = await seedRun(handle.db, companyId);
    const endpoints = {
      gdelt: site.baseUrl,
      secEfts: site.baseUrl,
      secData: site.baseUrl,
      cdx: site.baseUrl,
      wayback: site.baseUrl,
      greenhouse: site.baseUrl,
      lever: site.baseUrl,
      ashby: site.baseUrl,
      workable: site.baseUrl,
      companiesHouse: site.baseUrl,
    };
    const running = executeCollectRun(handle.db, runId, {
      endpoints,
      privateHostAllowlist: ["127.0.0.1"],
    });
    await new Promise((r) => setTimeout(r, 100));
    await cancelRun(handle.db, runId);
    const result = await running;
    expect(result.status).toBe("cancelled");
    expect(await runStatus(runId)).toBe("cancelled");
    // The in-flight homepage finished, but nothing after it was fetched.
    expect(site.hits.some((h) => h.path === "/sitemap.xml")).toBe(false);
  });
});

describe("runner", () => {
  it("fails running runs on boot and leaves queued ones queued", async () => {
    const a = await seedCompany(handle.db, { name: "A Co" });
    const b = await seedCompany(handle.db, { name: "B Co" });
    const running = await seedRun(handle.db, a);
    const queued = await seedRun(handle.db, b);
    await handle.db.update(researchRuns).set({ status: "queued" }).where(eq(researchRuns.id, queued));
    const runner = createRunner(handle.db, { execute: async () => {} });
    await runner.recover();
    try {
      expect(await runStatus(running)).toBe("failed");
      expect(await runStatus(queued)).toBe("queued");
      const [row] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, running));
      expect(row?.error).toBe("server restarted");
    } finally {
      await runner.stop();
    }
  });

  it("claims queued runs FIFO and respects the concurrency cap", async () => {
    const ids: string[] = [];
    for (const name of ["A", "B", "C", "D", "E"]) {
      ids.push(await seedCompany(handle.db, { name: `${name} Co` }));
    }
    const batch = await startCollect(handle.db, ids);
    // Created_at order is scrambled so FIFO is meaningful.
    const order = [4, 2, 0, 3, 1];
    for (let i = 0; i < order.length; i++) {
      const runId = batch.runs[order[i] as number]?.runId ?? "";
      await handle.db
        .update(researchRuns)
        .set({ createdAt: new Date(Date.now() + i * 1000) })
        .where(eq(researchRuns.id, runId));
    }
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runner = createRunner(handle.db, {
      concurrency: 2,
      execute: async (runId: string) => {
        started.push(runId);
        await gate;
      },
    });
    await runner.tick();
    expect(runner.activeCount()).toBe(2);
    expect(runner.maxActive()).toBe(2);
    // FIFO: the two earliest created runs started first.
    const expectedFirst = [batch.runs[order[0] as number]?.runId, batch.runs[order[1] as number]?.runId];
    expect(started).toEqual(expectedFirst);
    release();
    await runner.stop();
    expect(runner.activeCount()).toBe(0);
  });

  it("claims company collect subjobs like any collect run", async () => {
    const companyId = await seedCompany(handle.db, { name: "A Co" });
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const batch = await startCollect(handle.db, [companyId], undefined, { companyJobId: jobId, stage: "collect" });
    const runId = batch.runs[0]?.runId ?? "";
    const started: string[] = [];
    const runner = createRunner(handle.db, {
      execute: async (id: string) => {
        started.push(id);
      },
    });
    try {
      await runner.tick();
      expect(started).toEqual([runId]);
    } finally {
      await runner.stop();
    }
  });

  it("recover spares running extraction subjobs for the company worker", async () => {
    const companyId = await seedCompany(handle.db, { name: "A Co" });
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const [row] = await handle.db
      .insert(researchRuns)
      .values({
        id: randomUUID(),
        companyId,
        kind: "agent",
        status: "running",
        companyJobId: jobId,
        stage: "extraction",
      })
      .returning({ id: researchRuns.id });
    if (!row) throw new Error("no subjob row");
    const runner = createRunner(handle.db, { execute: async () => {} });
    try {
      await runner.recover();
      expect(await runStatus(row.id)).toBe("running");
    } finally {
      await runner.stop();
    }
  });

  it("a cancelled queued run never starts", async () => {
    const a = await seedCompany(handle.db, { name: "A Co" });
    const batch = await startCollect(handle.db, [a]);
    const runId = batch.runs[0]?.runId ?? "";
    await cancelRun(handle.db, runId);
    let calls = 0;
    const runner = createRunner(handle.db, {
      execute: async () => {
        calls += 1;
      },
    });
    await runner.tick();
    await runner.stop();
    expect(calls).toBe(0);
    expect(await runStatus(runId)).toBe("cancelled");
  });

  it("reaps runs idle for 10 minutes, with a fake clock", async () => {
    const a = await seedCompany(handle.db, { name: "A Co" });
    const b = await seedCompany(handle.db, { name: "B Co" });
    const stale = await seedRun(handle.db, a);
    const fresh = await seedRun(handle.db, b);
    const now = new Date("2026-10-20T12:00:00Z");
    await handle.db
      .update(researchRuns)
      .set({ lastActivityAt: new Date("2026-10-20T11:49:00Z") })
      .where(eq(researchRuns.id, stale));
    await handle.db
      .update(researchRuns)
      .set({ lastActivityAt: new Date("2026-10-20T11:55:00Z") })
      .where(eq(researchRuns.id, fresh));
    const runner = createRunner(handle.db, { clock: { now: () => now } });
    expect(await runner.reapStalled()).toBe(1);
    expect(await runStatus(stale)).toBe("stalled");
    expect(await runStatus(fresh)).toBe("running");
    await runner.stop();
  });
});
