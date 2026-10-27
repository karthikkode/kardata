import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  companies,
  companyIcpChecks,
  companyVerdicts,
  factKeys,
  facts,
  providerCalls,
  recordTypes,
  records,
  researchRuns,
  sectorCompanies,
  sectors,
  sources,
} from "../../src/db/schema.js";
import { recordVerdicts } from "../../src/domain/tiering.js";
import type { ClassifierCall } from "../../src/runs/sector-classify.js";
import { latestIcpCheck } from "../../src/domain/icp/reads.js";
import { runIcpCheck } from "../../src/runs/icp.js";
import { ICP_VOTES } from "../../src/domain/icp/judge.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;
const USAGE = { model: "muse-spark-1.3", inputTokens: 900, outputTokens: 50, cachedTokens: 100, reasoningTokens: 0, calls: 1 };

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

interface Seeded {
  sectorId: string;
  companyId: string;
  retailerRef: string;
  toolRef: string;
}

/** A synthetic researched company: one retailer record, one tool fact, one stale job post. */
async function seed(name = "Synthetic Trowel Co"): Promise<Seeded> {
  const db = handle.db;
  const sectorId = randomUUID();
  const companyId = randomUUID();
  const runId = randomUUID();
  const sourceId = randomUUID();
  await db.insert(sectors).values({ id: sectorId, name: `sector-${sectorId.slice(0, 6)}` });
  await db.insert(companies).values({ id: companyId, source: "manual", name, domain: "trowel.example" });
  await db.insert(sectorCompanies).values({ sectorId, companyId, addedVia: "manual" });
  await db.insert(researchRuns).values({ id: runId, companyId, kind: "collect", status: "succeeded" });
  await db.insert(sources).values({
    id: sourceId,
    companyId,
    runId,
    url: "https://trowel.example/",
    finalUrl: "https://trowel.example/",
    collector: "test",
    status: "ok",
    fetchedAt: new Date(),
  });
  await db
    .insert(factKeys)
    .values({ key: "marketing.tool", valueType: "text", description: "tool", createdBy: "test" })
    .onConflictDoNothing();
  for (const name of ["retailer", "job_posting"]) {
    await db.insert(recordTypes).values({ name, description: name, fields: [], naturalKey: ["name"], createdBy: "test" }).onConflictDoNothing();
  }
  const toolId = randomUUID();
  await db.insert(facts).values({
    id: toolId,
    companyId,
    runId,
    key: "marketing.tool",
    valueText: "Klaviyo",
    sourceIds: [sourceId],
    confidence: "high",
    verification: "verified",
    quote: "Powered by Klaviyo",
    createdBy: "extractor:marketing",
  });
  const retailerId = randomUUID();
  await db.insert(records).values({
    id: retailerId,
    companyId,
    type: "retailer",
    naturalKeyHash: "a",
    data: { name: "Synthetic Garden Mart", date: new Date().toISOString().slice(0, 10) },
    sourceIds: [sourceId],
    verification: "verified",
    quote: "Find us at Synthetic Garden Mart",
    createdBy: "extractor:business_model",
  });
  await db.insert(records).values({
    id: randomUUID(),
    companyId,
    type: "job_posting",
    naturalKeyHash: "b",
    data: { title: "Inventory Planner", posted_at: "2024-01-01" },
    sourceIds: [sourceId],
    createdBy: "collector:jobs",
  });
  return { sectorId, companyId, retailerRef: `r:${retailerId}`, toolRef: `f:${toolId}` };
}

const NO = { verdict: "no", evidence_refs: [], observation: "nothing shown" };
function fakeJudge(s: Seeded, prompts: string[] = []): ClassifierCall {
  return async ({ prompt }) => {
    prompts.push(prompt);
    const json = {
      signals: {
        channels: { verdict: "yes", evidence_refs: [s.retailerRef], observation: "Stocked by Synthetic Garden Mart." },
        hiring: NO,
        revenue_left: NO,
        review_pain: NO,
        recent_change: NO,
        tool_sprawl: { verdict: "yes", evidence_refs: [s.toolRef, "f:not-in-pack"], observation: "Runs Klaviyo." },
      },
      exclusions: { data_team: NO, parent_company: { ...NO, own_decision_maker: "unknown" }, not_d2c: NO },
      flags: { tech_team: NO },
    };
    return { json, raw: JSON.stringify(json), usage: USAGE };
  };
}

describe("runIcpCheck", () => {
  it("stores the check, writes the verdict and logs the Muse call", async () => {
    const s = await seed();
    const prompts: string[] = [];
    const out = await runIcpCheck(handle.db, { sectorId: s.sectorId, companyId: s.companyId, call: fakeJudge(s, prompts) });
    expect(out.decision).toMatchObject({ score: 2, status: "contactable" });
    // The stale job post never reached the judge.
    expect(prompts[0]).not.toContain("Inventory Planner");
    const [verdict] = await handle.db.select().from(companyVerdicts).where(eq(companyVerdicts.companyId, s.companyId));
    expect(verdict).toMatchObject({ score: 2, status: "contactable", source: `icp-v3:${out.checkId}` });
    expect(verdict?.signals).toMatchObject({ channels: true, tool_sprawl: true, hiring: false });
    const check = await latestIcpCheck(handle.db, s.companyId);
    expect(check?.evidence).toHaveLength(2);
    const tool = (check?.results as { signals: { key: string; droppedRefs: string[] }[] }).signals.find((r) => r.key === "tool_sprawl");
    expect(tool?.droppedRefs).toEqual(["f:not-in-pack"]);
    const calls = await handle.db.select().from(providerCalls).where(eq(providerCalls.runId, out.runId));
    expect(calls).toHaveLength(ICP_VOTES);
    expect(calls[0]).toMatchObject({ stage: "icp", inputTokens: 900 });
    expect((check?.results as { votes: Record<string, string> }).votes["signals.channels"]).toBe(`yes ${ICP_VOTES}`);
    expect(check?.usage).toMatchObject({ inputTokens: 900 * ICP_VOTES });
    const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, out.runId));
    expect(run).toMatchObject({ kind: "icp", stage: "icp", status: "succeeded" });
  });

  it("appends on a re-check and moves the verdict", async () => {
    const s = await seed();
    const first = await runIcpCheck(handle.db, { sectorId: s.sectorId, companyId: s.companyId, call: fakeJudge(s) });
    const second = await runIcpCheck(handle.db, { sectorId: s.sectorId, companyId: s.companyId, call: fakeJudge(s) });
    const rows = await handle.db.select().from(companyIcpChecks).where(eq(companyIcpChecks.companyId, s.companyId));
    expect(rows).toHaveLength(2);
    expect(first.checkId).not.toBe(second.checkId);
    const [verdict] = await handle.db.select().from(companyVerdicts).where(eq(companyVerdicts.companyId, s.companyId));
    expect(verdict?.source).toBe(`icp-v3:${second.checkId}`);
  });

  it("keeps a manual override verdict", async () => {
    const s = await seed();
    await recordVerdicts(handle.db, [
      { companyId: s.companyId, sectorId: s.sectorId, score: 0, signals: {}, status: "excluded", exclusionReason: "owner call", source: "override: owner, 2026-10-27" },
    ]);
    const out = await runIcpCheck(handle.db, { sectorId: s.sectorId, companyId: s.companyId, call: fakeJudge(s) });
    expect(out.verdictWritten).toBe(false);
    const [verdict] = await handle.db.select().from(companyVerdicts).where(eq(companyVerdicts.companyId, s.companyId));
    expect(verdict).toMatchObject({ status: "excluded", source: "override: owner, 2026-10-27" });
  });

  it("marks a company with no usable evidence research_incomplete, without a Muse call", async () => {
    const sectorId = randomUUID();
    const companyId = randomUUID();
    await handle.db.insert(sectors).values({ id: sectorId, name: "empty" });
    await handle.db.insert(companies).values({ id: companyId, source: "manual", name: "Empty Co" });
    await handle.db.insert(sectorCompanies).values({ sectorId, companyId, addedVia: "manual" });
    let called = false;
    const out = await runIcpCheck(handle.db, {
      sectorId,
      companyId,
      call: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });
    expect(called).toBe(false);
    expect(out.decision.status).toBe("research_incomplete");
  });

  it("fails the run on an invalid judgement and writes no verdict", async () => {
    const s = await seed();
    await expect(
      runIcpCheck(handle.db, { sectorId: s.sectorId, companyId: s.companyId, call: async () => ({ json: { signals: {} }, usage: USAGE }) }),
    ).rejects.toThrow(/invalid icp judgement/);
    const verdicts = await handle.db.select().from(companyVerdicts).where(eq(companyVerdicts.companyId, s.companyId));
    expect(verdicts).toHaveLength(0);
  });

  it("retries a stalled judge call once", async () => {
    const s = await seed();
    let calls = 0;
    const keys: string[] = [];
    const judge = fakeJudge(s);
    const out = await runIcpCheck(handle.db, {
      sectorId: s.sectorId,
      companyId: s.companyId,
      call: async (input) => {
        calls += 1;
        expect(input.stallMs).toBe(300_000);
        keys.push(input.callKey ?? "");
        if (calls === 1) throw new Error("classifier container exited 143: (stall)");
        return judge(input);
      },
    });
    expect(calls).toBe(ICP_VOTES + 1);
    // Every call, retries included, gets its own container name.
    expect(new Set(keys).size).toBe(keys.length);
    expect(out.decision.status).toBe("contactable");
  });

  it("refuses a company outside the sector", async () => {
    const s = await seed();
    const other = await seed("Other Co");
    await expect(runIcpCheck(handle.db, { sectorId: s.sectorId, companyId: other.companyId, call: fakeJudge(s) })).rejects.toThrow(/not in this sector/);
  });
});
