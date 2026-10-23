import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, companyJobs } from "../../src/db/schema.js";
import { quotaBreakerGet } from "../../src/domain/quota/breaker.js";
import { startCompanyJob } from "../../src/runs/company.js";
import {
  createQuotaMonitor,
  quotaSnapshotGet,
  type QuotaReading,
} from "../../src/runs/quota-monitor.js";
import { checkpointGet, pipelinePausedGet, tripPipelinePause } from "../../src/runs/settings.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

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

async function makeCompany(name: string): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

function reading(overrides: Partial<QuotaReading> = {}): QuotaReading {
  return {
    fivePct: 10,
    fiveResetAt: "2026-10-24T00:07:00.000Z",
    weeklyPct: 40,
    weeklyResetAt: "2026-10-26T00:00:00.000Z",
    ...overrides,
  };
}

function monitorWith(first: QuotaReading | null, rest: (QuotaReading | null)[] = []) {
  const queue = [first, ...rest];
  return createQuotaMonitor(handle.db, {
    clock: () => new Date("2026-10-23T19:00:00.000Z"),
    readUsage: async () => queue.shift() ?? null,
  });
}

describe("quota monitor", () => {
  it("stores the snapshot and does nothing below 90", async () => {
    await monitorWith(reading()).poll();
    expect(await quotaSnapshotGet(handle.db)).toMatchObject({
      fivePct: 10,
      weeklyPct: 40,
      checkedAt: "2026-10-23T19:00:00.000Z",
    });
    expect((await checkpointGet(handle.db)).target).toBeNull();
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
  });

  it("freezes intake at 90 and clears it when usage falls back", async () => {
    const monitor = monitorWith(reading({ weeklyPct: 90 }), [reading({ weeklyPct: 90 }), reading()]);
    await monitor.poll();
    expect((await checkpointGet(handle.db)).target).toBe(1);
    await monitor.poll();
    expect((await checkpointGet(handle.db)).target).toBe(1);
    await monitor.poll();
    expect((await checkpointGet(handle.db)).target).toBeNull();
  });

  it("never touches an owner pause, even at 90", async () => {
    await tripPipelinePause(handle.db, 10, 10);
    const monitor = monitorWith(reading({ fivePct: 91 }), [reading()]);
    await monitor.poll();
    expect((await checkpointGet(handle.db)).target).toBeNull();
    expect((await pipelinePausedGet(handle.db)).paused).toBe(true);
    await monitor.poll();
    expect((await pipelinePausedGet(handle.db)).paused).toBe(true);
  });

  it("trips the breaker at weekly 95 with the reported reset", async () => {
    const companyId = await makeCompany("Agent Co");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await monitorWith(reading({ weeklyPct: 96 })).poll();
    const trip = await quotaBreakerGet(handle.db);
    expect(trip.tripped).toBe(true);
    if (!trip.tripped) throw new Error("expected a trip");
    expect(trip.resumeAt).toBe("2026-10-26T00:00:00.000Z");
    const [job] = await handle.db.select().from(companyJobs).where(eq(companyJobs.id, jobId));
    expect(job?.status).toBe("paused");
  });

  it("a null reading changes nothing", async () => {
    await monitorWith(null).poll();
    expect(await quotaSnapshotGet(handle.db)).toBeNull();
    expect((await checkpointGet(handle.db)).target).toBeNull();
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
  });

  it("a throwing reader changes nothing", async () => {
    const monitor = createQuotaMonitor(handle.db, {
      readUsage: async () => {
        throw new Error("endpoint down");
      },
    });
    await monitor.poll();
    expect(await quotaSnapshotGet(handle.db)).toBeNull();
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
  });
});
