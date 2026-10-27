import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  companies,
  companyJobs,
  researchRuns,
  sectorCompanies,
  sectorPreflight,
  sectorPreflightItems,
  sectorPreflightJobs,
  sectors,
} from "../../src/db/schema.js";
import {
  createSectorRunner,
  sectorPreflightCancel,
  sectorPreflightPause,
  sectorPreflightResume,
  sectorPreflightRetryFailed,
  sectorPreflightStatus,
  sectorPreflightCompanies,
  sectorPreflightSummary,
  startPipeline,
  startSectorPreflight,
} from "../../src/runs/sector.js";
import {
  sectorPreflightSettingsGet,
  sectorPreflightSettingsSet,
} from "../../src/runs/settings.js";
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

async function makeSector(name: string): Promise<string> {
  const [row] = await handle.db
    .insert(sectors)
    .values({ id: randomUUID(), name })
    .returning({ id: sectors.id });
  if (!row) throw new Error("no sector row");
  return row.id;
}

async function addCompany(sectorId: string, name: string): Promise<string> {
  const [company] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name })
    .returning({ id: companies.id });
  if (!company) throw new Error("no company row");
  await handle.db.insert(sectorCompanies).values({ sectorId, companyId: company.id, addedVia: "manual" });
  return company.id;
}

const USAGE = { inputTokens: 100, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0, calls: 1 };

function succeedCall(patch: Record<string, unknown> = {}) {
  return async ({ sectorId, companyId, runId }: { sectorId: string; companyId: string; runId: string }) => {
    await handle.db
      .update(researchRuns)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        agentUsage: { ...USAGE, childrenIncluded: false },
      })
      .where(eq(researchRuns.id, runId));
    await handle.db.insert(sectorPreflight).values({
      id: randomUUID(),
      sectorId,
      companyId,
      runId,
      businessType: "dtc_brand",
      primaryCategory: "skincare",
      sellsOwnProducts: true,
      hasOnlineStore: true,
      confidence: "high",
      reason: "fake",
      ...patch,
    });
  };
}

function failCall(error: string) {
  return async ({ runId }: { runId: string }) => {
    await handle.db
      .update(researchRuns)
      .set({ status: "failed", error, finishedAt: new Date() })
      .where(eq(researchRuns.id, runId));
  };
}

async function itemStatuses(jobId: string): Promise<string[]> {
  const rows = await handle.db
    .select()
    .from(sectorPreflightItems)
    .where(eq(sectorPreflightItems.jobId, jobId));
  return rows.map((r) => r.status).sort();
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
}

describe("startSectorPreflight", () => {
  it("creates one item per member and skips classified ones when onlyPending", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    await handle.db.insert(sectorPreflight).values({
      id: randomUUID(),
      sectorId,
      companyId: a,
      businessType: "dtc_brand",
      primaryCategory: "skincare",
      sellsOwnProducts: true,
      hasOnlineStore: true,
      confidence: "high",
      reason: "prior",
    });
    const pending = await startSectorPreflight(handle.db, { sectorId });
    expect(pending.companies).toBe(1);
    const all = await startSectorPreflight(handle.db, { sectorId, onlyPending: false });
    expect(all.companies).toBe(2);
    const capped = await startSectorPreflight(handle.db, { sectorId, onlyPending: false, maxCompanies: 1 });
    expect(capped.companies).toBe(1);
    await expect(startSectorPreflight(handle.db, { sectorId: randomUUID() })).rejects.toThrow(/sector not found/);
    expect(b).toBeTruthy();
  });

  it("re-classifies only low-confidence companies with onlyLowConfidence", async () => {
    const sectorId = await makeSector("Skincare");
    const sure = await addCompany(sectorId, "A Co");
    const unsure = await addCompany(sectorId, "B Co");
    await addCompany(sectorId, "C Co");
    const row = (companyId: string, confidence: "high" | "medium" | "low") => ({
      id: randomUUID(),
      sectorId,
      companyId,
      businessType: "dtc_brand",
      primaryCategory: "skincare",
      sellsOwnProducts: true,
      hasOnlineStore: true,
      confidence,
      reason: "prior",
    });
    await handle.db.insert(sectorPreflight).values([row(sure, "high"), row(unsure, "low")]);
    const low = await startSectorPreflight(handle.db, { sectorId, onlyLowConfidence: true });
    expect(low.companies).toBe(1);
    const items = await handle.db.select().from(sectorPreflightItems).where(eq(sectorPreflightItems.jobId, low.jobId));
    expect(items.map((i) => i.companyId)).toEqual([unsure]);
    await expect(
      startSectorPreflight(handle.db, { sectorId, onlyLowConfidence: true, onlyPending: true }),
    ).rejects.toThrow(/drop onlyPending/);
  });

  it("starts a subset by companyIds and rejects outsiders", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    await addCompany(sectorId, "B Co");
    const subset = await startSectorPreflight(handle.db, { sectorId, companyIds: [a] });
    expect(subset.companies).toBe(1);
    const items = await handle.db
      .select()
      .from(sectorPreflightItems)
      .where(eq(sectorPreflightItems.jobId, subset.jobId));
    expect(items.map((i) => i.companyId)).toEqual([a]);
    await expect(startSectorPreflight(handle.db, { sectorId, companyIds: [randomUUID()] })).rejects.toThrow(
      /not in this sector/,
    );
  });
});

describe("sector runner", () => {
  it("feeds at the pool size and finalizes successes with derivation", async () => {
    const sectorId = await makeSector("Skincare");
    await addCompany(sectorId, "A Co");
    await addCompany(sectorId, "B Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    const runner = createSectorRunner(handle.db, { pool: 1, classify: succeedCall() });
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["queued", "running"]);
    await settle();
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["running", "succeeded"]);
    await settle();
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["succeeded", "succeeded"]);
    const [job] = await handle.db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
    expect(job?.status).toBe("completed");
    expect(job?.inputTokensSpent).toBe(200);
    // Success derives eligibility immediately.
    const members = await handle.db.select().from(sectorCompanies).where(eq(sectorCompanies.sectorId, sectorId));
    expect(members.every((m) => m.eligibility === "eligible")).toBe(true);
  });

  it("auto-pauses on 3 same-class failures", async () => {
    const sectorId = await makeSector("Skincare");
    await addCompany(sectorId, "A Co");
    await addCompany(sectorId, "B Co");
    await addCompany(sectorId, "C Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    const runner = createSectorRunner(handle.db, { pool: 1, classify: failCall("boom") });
    for (let i = 0; i < 3; i += 1) {
      await runner.tick();
      await settle();
      await runner.tick();
    }
    const [job] = await handle.db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
    expect(job?.status).toBe("paused");
    expect(job?.errorStreak).toBe(3);
    expect(job?.pauseReason).toMatch(/3 consecutive failed/);
  });

  it("pauses on budget and resumes", async () => {
    const sectorId = await makeSector("Skincare");
    await addCompany(sectorId, "A Co");
    await addCompany(sectorId, "B Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId, budget: { maxTokens: 50 } });
    const runner = createSectorRunner(handle.db, { pool: 2, classify: succeedCall() });
    await runner.tick();
    await settle();
    await runner.tick();
    const [job] = await handle.db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
    expect(job?.status).toBe("paused");
    expect(job?.pauseReason).toMatch(/maxTokens/);
    await sectorPreflightResume(handle.db, jobId);
    const [resumed] = await handle.db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
    expect(resumed?.status).toBe("running");
    expect(resumed?.errorStreak).toBe(0);
  });

  it("relaunches restart orphans with a fresh run", async () => {
    const sectorId = await makeSector("Skincare");
    await addCompany(sectorId, "A Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    // The first worker's drive blocks mid-flight, like a killed process.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocking = async (args: { sectorId: string; companyId: string; runId: string }) => {
      await gate;
      await succeedCall()(args);
    };
    const runner = createSectorRunner(handle.db, { pool: 1, classify: blocking });
    await runner.tick();
    const [item] = await handle.db.select().from(sectorPreflightItems).where(eq(sectorPreflightItems.jobId, jobId));
    expect(item?.status).toBe("running");
    // A fresh worker (no in-flight drives) sees a running orphan: fail the
    // stale run and relaunch in the same tick.
    const fresh = createSectorRunner(handle.db, { pool: 1, classify: succeedCall() });
    await fresh.tick();
    const [relaunched] = await handle.db.select().from(sectorPreflightItems).where(eq(sectorPreflightItems.id, item!.id));
    expect(relaunched?.status).toBe("running");
    expect(relaunched?.runId).not.toBe(item?.runId);
    expect(relaunched?.attempts).toBe(2);
    const [stale] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, item!.runId!));
    expect(stale?.status).toBe("failed");
    release();
    await settle();
  });

  it("classify runs coexist with an active company run for the same company", async () => {
    const sectorId = await makeSector("Skincare");
    const companyId = await addCompany(sectorId, "Busy Co");
    await handle.db.insert(researchRuns).values({ id: randomUUID(), companyId, kind: "agent", status: "running" });
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    const runner = createSectorRunner(handle.db, { pool: 1, classify: succeedCall() });
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["running"]);
    await settle();
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["succeeded"]);
    // But two agent runs still conflict (unique violation 23505).
    const conflict = await handle.db
      .insert(researchRuns)
      .values({ id: randomUUID(), companyId, kind: "agent", status: "queued" })
      .then(
        () => null,
        (e: unknown) => e as { cause?: { code?: string } },
      );
    expect(conflict?.cause?.code).toBe("23505");
  });

  it("marks launch failures failed and keeps feeding the rest", async () => {
    const sectorId = await makeSector("Skincare");
    const bad = await addCompany(sectorId, "Bad Co");
    await addCompany(sectorId, "Good Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    const { createSectorRun } = await import("../../src/runs/sector-classify.js");
    const runner = createSectorRunner(handle.db, {
      pool: 2,
      classify: succeedCall(),
      createRun: async (db, companyId) => {
        if (companyId === bad) throw new Error("boom");
        return createSectorRun(db, companyId);
      },
    });
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["failed", "running"]);
    const items = await handle.db
      .select()
      .from(sectorPreflightItems)
      .where(eq(sectorPreflightItems.jobId, jobId));
    const failed = items.find((i) => i.companyId === bad);
    expect(failed?.error).toMatch(/launch: boom/);
    const [job] = await handle.db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
    expect(job?.errorStreak).toBe(1);
    await settle();
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["failed", "succeeded"]);
  });

  it("holds launches when memory is low and counts the hold", async () => {
    const sectorId = await makeSector("Skincare");
    await addCompany(sectorId, "A Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    const held = createSectorRunner(handle.db, {
      pool: 2,
      classify: succeedCall(),
      memAvailableMB: () => 1024,
    });
    await held.tick();
    expect(await itemStatuses(jobId)).toEqual(["queued"]);
    const [job] = await handle.db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
    expect(job?.memHolds).toBe(1);
    const freed = createSectorRunner(handle.db, {
      pool: 2,
      classify: succeedCall(),
      memAvailableMB: () => 20 * 1024,
    });
    await freed.tick();
    expect(await itemStatuses(jobId)).toEqual(["running"]);
    await settle();
  });

  it("pause stops feeding; cancel stops runs; retry re-queues failures", async () => {
    const sectorId = await makeSector("Skincare");
    await addCompany(sectorId, "A Co");
    await addCompany(sectorId, "B Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    await sectorPreflightPause(handle.db, jobId);
    const runner = createSectorRunner(handle.db, { pool: 2, classify: succeedCall() });
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["queued", "queued"]);
    await sectorPreflightResume(handle.db, jobId);
    await runner.tick();
    expect(await itemStatuses(jobId)).toContain("running");
    const cancelled = await sectorPreflightCancel(handle.db, jobId);
    expect(cancelled.status).toBe("cancelled");
    expect(await itemStatuses(jobId)).toEqual(["cancelled", "cancelled"]);
    // Retry failed items (re-queue one manually to failed first).
    const [item] = await handle.db.select().from(sectorPreflightItems).where(eq(sectorPreflightItems.jobId, jobId));
    await handle.db.update(sectorPreflightItems).set({ status: "failed" }).where(eq(sectorPreflightItems.id, item!.id));
    const retried = await sectorPreflightRetryFailed(handle.db, jobId);
    expect(retried.retried).toBe(1);
    expect(retried.job.status).toBe("running");
  });
});

describe("sectorPreflightStatus", () => {
  it("reports counts, spend, ETA and null quota", async () => {
    const sectorId = await makeSector("Skincare");
    await addCompany(sectorId, "A Co");
    await addCompany(sectorId, "B Co");
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    const runner = createSectorRunner(handle.db, { pool: 1, classify: succeedCall() });
    await runner.tick();
    await settle();
    await runner.tick();
    const status = await sectorPreflightStatus(handle.db, jobId);
    expect(status.counts).toEqual({ running: 1, succeeded: 1 });
    expect(status.tokens.spent).toBe(100);
    expect(status.etaSeconds).toBe(0);
    expect(status.quota).toBeNull();
    expect(status.items).toHaveLength(2);
  });
});

describe("sectorPreflightSummary", () => {
  it("buckets by type x category x eligibility with examples", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    const runner = createSectorRunner(handle.db, {
      pool: 2,
      classify: async ({ sectorId: s, companyId, runId }) => {
        const patch = companyId === a ? {} : { businessType: "clinic_medical", primaryCategory: "other" };
        await succeedCall(patch)({ sectorId: s, companyId, runId });
      },
    });
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    await runner.tick();
    await settle();
    await runner.tick();
    await settle();
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["succeeded", "succeeded"]);
    const summary = await sectorPreflightSummary(handle.db, sectorId);
    expect(summary.buckets).toHaveLength(2);
    const dtc = summary.buckets.find((bucket) => bucket.businessType === "dtc_brand");
    expect(dtc?.eligibility).toBe("eligible");
    expect(dtc?.examples).toHaveLength(1);
    expect(dtc?.examples[0]?.name).toBe("A Co");
    expect(b).toBeTruthy();
  });
});

describe("sectorPreflightCompanies", () => {
  it("lists per-company classifications with filters and paging", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    await addCompany(sectorId, "C Co");
    const runner = createSectorRunner(handle.db, {
      pool: 3,
      classify: async ({ sectorId: s, companyId, runId }) => {
        const patch = companyId === a ? {} : { businessType: "clinic_medical", primaryCategory: "other" };
        await succeedCall(patch)({ sectorId: s, companyId, runId });
      },
    });
    await startSectorPreflight(handle.db, { sectorId, companyIds: [a, b] });
    await runner.tick();
    await settle();
    await runner.tick();
    await settle();
    await runner.tick();
    const all = await sectorPreflightCompanies(handle.db, { sectorId });
    expect(all.total).toBe(2);
    expect(all.rows.map((r) => r.name)).toEqual(["A Co", "B Co"]);
    expect(all.rows[0]?.eligibility).toBe("eligible");
    const out = await sectorPreflightCompanies(handle.db, { sectorId, eligibility: ["ineligible"] });
    expect(out.rows.map((r) => r.companyId)).toEqual([b]);
    expect(out.rows[0]?.businessType).toBe("clinic_medical");
    const page = await sectorPreflightCompanies(handle.db, { sectorId, limit: 1, offset: 1 });
    expect(page.total).toBe(2);
    expect(page.rows.map((r) => r.name)).toEqual(["B Co"]);
    expect((await sectorPreflightCompanies(handle.db, { sectorId, confidence: ["low"] })).total).toBe(0);
    await expect(sectorPreflightCompanies(handle.db, { sectorId, limit: 0 })).rejects.toThrow(/limit/);
  });
});

describe("startPipeline", () => {
  it("creates jobs for eligible companies only", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    const c = await addCompany(sectorId, "C Co");
    const d = await addCompany(sectorId, "D Co");
    const e = await addCompany(sectorId, "E Co");
    const runner = createSectorRunner(handle.db, {
      pool: 3,
      classify: async ({ sectorId: s, companyId, runId }) => {
        const patch = companyId === c ? { businessType: "clinic_medical", primaryCategory: "other" } : {};
        await succeedCall(patch)({ sectorId: s, companyId, runId });
      },
    });
    const { jobId } = await startSectorPreflight(handle.db, { sectorId });
    await runner.tick();
    await settle();
    await runner.tick();
    await settle();
    await runner.tick();
    expect(await itemStatuses(jobId)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded", "succeeded"]);
    const { startCompanyJob } = await import("../../src/runs/company.js");
    await startCompanyJob(handle.db, { companyId: a, defer: true });
    await handle.db.insert(companyJobs).values([
      { id: randomUUID(), companyId: d, status: "failed", errorClass: "stall" },
      { id: randomUUID(), companyId: e, status: "terminated" },
    ]);
    const result = await startPipeline(handle.db, sectorId);
    expect(result).toEqual({ created: 3, skipped: 1, eligible: 4 });
    expect(b).toBeTruthy();
  });

  it("launches only the given categories when filtered", async () => {
    const sectorId = await makeSector("Skincare");
    const a = await addCompany(sectorId, "A Co");
    const b = await addCompany(sectorId, "B Co");
    for (const [id, category] of [[a, "skincare"], [b, "haircare"]] as const) {
      await handle.db.insert(sectorPreflight).values({
        id: randomUUID(),
        sectorId,
        companyId: id,
        businessType: "dtc_brand",
        primaryCategory: category,
        sellsOwnProducts: true,
        hasOnlineStore: true,
        confidence: "high",
        reason: "seeded",
      });
    }
    await handle.db
      .update(sectorCompanies)
      .set({ eligibility: "eligible" })
      .where(eq(sectorCompanies.sectorId, sectorId));
    const filtered = await startPipeline(handle.db, sectorId, { categories: ["skincare"] });
    expect(filtered).toEqual({ created: 1, skipped: 0, eligible: 1 });
    const all = await startPipeline(handle.db, sectorId);
    expect(all).toEqual({ created: 1, skipped: 1, eligible: 2 });
  });
});

describe("sector preflight pool settings", () => {
  it("defaults to 8 and validates the range", async () => {
    await expect(sectorPreflightSettingsGet(handle.db)).resolves.toMatchObject({ sectorPreflightConcurrency: 8 });
    await expect(sectorPreflightSettingsSet(handle.db, 0)).rejects.toThrow(/1\.\.64/);
    await expect(sectorPreflightSettingsSet(handle.db, 65)).rejects.toThrow(/1\.\.64/);
    await expect(sectorPreflightSettingsSet(handle.db, 64)).resolves.toMatchObject({ sectorPreflightConcurrency: 64, source: "db" });
    await expect(sectorPreflightSettingsSet(handle.db, 4)).resolves.toMatchObject({ sectorPreflightConcurrency: 4, source: "db" });
  });
});
