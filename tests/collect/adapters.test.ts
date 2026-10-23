import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, researchRuns, type ResearchRun } from "../../src/db/schema.js";
import { ADAPTERS, getAdapter, resolvePlanAdapters } from "../../src/collect/adapters.js";
import { COLLECTORS } from "../../src/collect/collectors/index.js";
import { executeCollectRun, resolveRunAdapters } from "../../src/collect/run.js";
import { savePreflightReport } from "../../src/domain/company-jobs/preflight.js";
import { startCompanyJob } from "../../src/runs/company.js";
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

async function makeRun(companyId: string, opts: { jobId?: string; stage?: ResearchRun["stage"] } = {}): Promise<ResearchRun> {
  const [row] = await handle.db
    .insert(researchRuns)
    .values({
      id: randomUUID(),
      companyId,
      kind: "collect",
      status: "queued",
      companyJobId: opts.jobId ?? null,
      stage: opts.stage ?? null,
    })
    .returning();
  if (!row) throw new Error("no run row");
  return row;
}

async function fileReport(jobId: string, companyId: string, adapterIds: string[]): Promise<void> {
  await savePreflightReport(handle.db, {
    jobId,
    companyId,
    report: {
      version: 1,
      reviewLocations: [],
      adaptersRequired: adapterIds.map((adapterId) => ({ adapterId, reason: "test" })),
      adaptersMissing: [],
      collectDirectives: { areas: [], notes: "" },
      confidence: 0.9,
      notes: "",
    },
  });
}

describe("adapter registry", () => {
  it("mirrors the collector registry one to one", () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual(COLLECTORS.map((c) => c.name).sort());
    for (const adapter of ADAPTERS) {
      const collector = COLLECTORS.find((c) => c.name === adapter.id);
      expect(adapter.areas).toEqual(collector?.areas);
      expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(adapter.blurb.length).toBeGreaterThan(0);
    }
  });

  it("resolves plans in fixed order, deduped, reporting unknown ids", () => {
    const { adapters, unknown } = resolvePlanAdapters(["stack", "site", "stack", "nope"]);
    expect(adapters.map((a) => a.id)).toEqual(["site", "stack"]);
    expect(unknown).toEqual(["nope"]);
    expect(getAdapter("site")?.areas).toContain("business_model");
    expect(getAdapter("nope")).toBeNull();
  });

  it("runs reviews before reviews_onsite whatever the plan order", () => {
    const { adapters } = resolvePlanAdapters(["reviews_onsite", "reviews", "shopify"]);
    expect(adapters.map((a) => a.id)).toEqual(["shopify", "reviews", "reviews_onsite"]);
  });
});

describe("resolveRunAdapters", () => {
  it("runs the preflight plan for company collect subjobs", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await fileReport(jobId, companyId, ["stack", "site", "nope"]);
    const run = await makeRun(companyId, { jobId, stage: "collect" });
    const resolved = await resolveRunAdapters(handle.db, run);
    expect(resolved.planned).toBe(true);
    expect(resolved.adapters.map((a) => a.id)).toEqual(["site", "stack"]);
    expect(resolved.unknown).toEqual(["nope"]);
  });

  it("orders a reversed plan by the fixed adapter order", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await fileReport(jobId, companyId, ["reviews_onsite", "reviews"]);
    const run = await makeRun(companyId, { jobId, stage: "collect" });
    const resolved = await resolveRunAdapters(handle.db, run);
    expect(resolved.planned).toBe(true);
    expect(resolved.adapters.map((a) => a.id)).toEqual(["reviews", "reviews_onsite"]);
  });

  it("runs everything for legacy runs and unplanned jobs", async () => {
    const legacy = await makeRun(await makeCompany("Legacy"));
    expect((await resolveRunAdapters(handle.db, legacy)).planned).toBe(false);
    expect((await resolveRunAdapters(handle.db, legacy)).adapters).toHaveLength(ADAPTERS.length);
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const noReport = await makeRun(companyId, { jobId, stage: "collect" });
    const fallback = await resolveRunAdapters(handle.db, noReport);
    expect(fallback.planned).toBe(false);
    expect(fallback.adapters).toHaveLength(ADAPTERS.length);
  });
});

describe("executeCollectRun with adapters", () => {
  it("honors detect() and reports what ran", async () => {
    const companyId = await makeCompany("Acme");
    const run = await makeRun(companyId);
    const collected: string[] = [];
    const result = await executeCollectRun(handle.db, run.id, {
      adapters: [
        {
          id: "skipped",
          version: "9.9.9",
          areas: ["product"],
          blurb: "synthetic skip",
          detect: async () => ({ applies: false, reason: "no signal" }),
          collect: async () => {
            throw new Error("must not run");
          },
        },
        {
          id: "ran",
          version: "9.9.9",
          areas: ["other"],
          blurb: "synthetic run",
          collect: async () => {
            collected.push("ran");
            return { outcomes: [{ area: "other", status: "done" as const }] };
          },
        },
      ],
    });
    expect(collected).toEqual(["ran"]);
    expect(result.adapters).toEqual(["skipped", "ran"]);
    expect(result.skippedAdapters).toEqual([{ id: "skipped", reason: "no signal" }]);
    expect(result.unknownAdapters).toEqual([]);
    expect(result.status).toBe("succeeded");
    const [row] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, run.id));
    expect(row?.status).toBe("succeeded");
  });
});
