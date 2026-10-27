import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  areaStatuses,
  companies,
  documents,
  factKeys,
  facts,
  records,
  recordTypes,
  researchRuns,
  sources,
  type Company,
  type ResearchRun,
} from "../../src/db/schema.js";
import { composeResearchBrief } from "../../src/domain/company-jobs/brief.js";
import { savePreflightReport } from "../../src/domain/company-jobs/preflight.js";
import { startCompanyJob } from "../../src/runs/company.js";
import { buildStagePrompt, buildStagePromptForRun } from "../../src/runs/prompt.js";
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

const REPORT = {
  version: 1,
  reviewLocations: [
    { platform: "Trustpilot", url: "https://trustpilot.example/acme", evidence: "profile with 120 reviews" },
    { platform: "Site", url: null, evidence: "no review widget found" },
  ],
  adaptersRequired: [{ adapterId: "shopify", reason: "storefront" }],
  adaptersMissing: [],
  collectDirectives: { areas: ["reviews"], notes: "paged widget" },
  confidence: 0.8,
  notes: "recon done",
};

async function fileReport(jobId: string, companyId: string): Promise<void> {
  await savePreflightReport(handle.db, { jobId, companyId, report: REPORT });
}

async function collectSubjob(jobId: string, companyId: string): Promise<string> {
  const runId = randomUUID();
  await handle.db.insert(researchRuns).values({
    id: runId,
    companyId,
    kind: "collect",
    status: "succeeded",
    startedAt: new Date(Date.now() - 60_000),
    finishedAt: new Date(),
    companyJobId: jobId,
    stage: "collect",
  });
  await handle.db.insert(areaStatuses).values([
    { runId, area: "reviews", companyId, status: "done" },
    { runId, area: "product", companyId, status: "not_found", reason: "no catalog" },
  ]);
  await handle.db.insert(sources).values({
    id: randomUUID(),
    companyId,
    runId,
    url: "https://acme.example/products.json",
    finalUrl: "https://acme.example/products.json",
    collector: "shopify",
    status: "ok",
  });
  await handle.db.insert(factKeys).values({
    key: "company.founded_year",
    valueType: "number",
    description: "founded",
    createdBy: "test",
  }).onConflictDoNothing();
  await handle.db.insert(facts).values({
    id: randomUUID(),
    companyId,
    runId,
    key: "company.founded_year",
    valueNum: "2019",
    sourceIds: [randomUUID()],
    confidence: "high",
    createdBy: "test",
  });
  await handle.db.insert(recordTypes).values({ name: "product", description: "p", fields: [], naturalKey: ["id"], createdBy: "test" }).onConflictDoNothing();
  await handle.db.insert(records).values({
    id: randomUUID(),
    companyId,
    type: "product",
    naturalKeyHash: "h",
    data: {},
    sourceIds: [randomUUID()],
    lastSeenRunId: runId,
    createdBy: "test",
  });
  await handle.db.insert(documents).values({
    id: randomUUID(),
    companyId,
    runId,
    kind: "extract",
    title: "t",
    contentMd: "x",
    createdBy: "test",
    contentSha256: "s",
  });
  return runId;
}

describe("composeResearchBrief", () => {
  it("returns null without a filed report", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await expect(composeResearchBrief(handle.db, jobId)).resolves.toBeNull();
  });

  it("briefs from preflight alone when collect has not run", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await fileReport(jobId, companyId);
    const brief = await composeResearchBrief(handle.db, jobId);
    expect(brief).toContain("Pipeline context");
    expect(brief).toContain("Trustpilot");
    expect(brief).toContain("Collect: not run yet.");
  });

  it("composes preflight + collect outcome with counts and sources", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await fileReport(jobId, companyId);
    await collectSubjob(jobId, companyId);
    const brief = await composeResearchBrief(handle.db, jobId);
    expect(brief).toContain("confidence 0.80");
    expect(brief).toContain("Adapters used: shopify.");
    expect(brief).toContain("Collect: succeeded");
    expect(brief).toContain("reviews: done; product: not_found (no catalog)");
    expect(brief).toContain("1 sources, 1 facts, 1 records, 1 documents");
    expect(brief).toContain("[shopify] https://acme.example/products.json (ok)");
  });
});

describe("buildStagePromptForRun", () => {
  async function ctxFor(stage: ResearchRun["stage"], jobId: string | null): Promise<{ run: ResearchRun; company: Company }> {
    const companyId = await makeCompany("Acme");
    const [company] = await handle.db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) throw new Error("no company");
    const [run] = await handle.db
      .insert(researchRuns)
      .values({
        id: randomUUID(),
        companyId,
        kind: "agent",
        status: "queued",
        promptVersion: "v1.5",
        companyJobId: jobId,
        stage,
      })
      .returning();
    if (!run) throw new Error("no run");
    return { run, company };
  }

  it("appends the brief for research subjobs only", async () => {
    const companyId = await makeCompany("Brief Co");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await fileReport(jobId, companyId);
    await collectSubjob(jobId, companyId);
    const ctx = await ctxFor("research", jobId);
    const withBrief = await buildStagePromptForRun(handle.db, { ...ctx, brief: undefined, sectorProfile: null });
    expect(withBrief).toContain("Pipeline context");
    expect(withBrief.startsWith(buildStagePrompt({ ...ctx, brief: undefined, sectorProfile: null }))).toBe(true);
  });

  it("leaves legacy and preflight prompts untouched", async () => {
    const legacy = await ctxFor(null, null);
    await expect(buildStagePromptForRun(handle.db, { ...legacy, brief: undefined, sectorProfile: null })).resolves.toBe(
      buildStagePrompt({ ...legacy, brief: undefined, sectorProfile: null }),
    );
    const companyId = await makeCompany("Pre Co");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const preflight = await ctxFor("preflight", jobId);
    await expect(buildStagePromptForRun(handle.db, { ...preflight, brief: undefined, sectorProfile: null })).resolves.toBe(
      buildStagePrompt({ ...preflight, brief: undefined, sectorProfile: null }),
    );
  });
});
