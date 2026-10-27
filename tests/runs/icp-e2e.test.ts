import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import {
  companies,
  companyJobs,
  factKeys,
  facts,
  recordTypes,
  records,
  researchRuns,
  sectorCompanies,
  sectors,
  sources,
} from "../../src/db/schema.js";
import { allCheckedRows, outreachCsv, outreachSheetRows } from "../../src/domain/icp/sheet.js";
import { sectorTierSummary } from "../../src/domain/tiering.js";
import { runIcpCheck } from "../../src/runs/icp.js";
import type { ClassifierCall } from "../../src/runs/sector-classify.js";
import { createSectorRunner, sectorPreflightStatus, startSectorIcp } from "../../src/runs/sector.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

/**
 * Stage 5.5 Step 6: synthetic garden companies with researched facts and
 * records go through the sector ICP job, the verdicts, the tier summary and
 * the outreach sheet. Invented names only; the judge is faked.
 */

let handle: DbHandle;
const TODAY = new Date().toISOString().slice(0, 10);
const USAGE = { model: "muse-spark-1.3", inputTokens: 5000, outputTokens: 200, cachedTokens: 0, reasoningTokens: 0, calls: 1 };

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

type Seed = {
  name: string;
  staff?: number;
  facts?: { key: string; text: string }[];
  records?: { type: string; data: Record<string, unknown> }[];
};

const COMPANIES: Seed[] = [
  {
    name: "Bramble & Bough",
    staff: 80, // ~$14M from staff: Tier A
    facts: [{ key: "marketing.tool", text: "Klaviyo and Omnisend" }],
    records: [
      { type: "retailer", data: { name: "Synthetic Garden Mart", date: TODAY } },
      { type: "review", data: { text: "Order arrived three weeks late", rating: 2, date: TODAY } },
    ],
  },
  {
    name: "Pip & Trowel",
    staff: 20, // ~$3.5M: Tier B
    records: [
      { type: "retailer", data: { name: "Synthetic Outdoor Hall", date: TODAY } },
      { type: "job_posting", data: { title: "Inventory Coordinator (Excel)", posted_at: TODAY } },
    ],
  },
  { name: "Lone Fern", staff: 20, facts: [{ key: "marketing.tool", text: "Klaviyo" }] },
  {
    name: "Metric Meadow",
    staff: 40,
    facts: [{ key: "marketing.tool", text: "Klaviyo and Omnisend" }],
    records: [
      { type: "retailer", data: { name: "Synthetic Garden Mart", date: TODAY } },
      { type: "leader", data: { name: "Synthetic Person", title: "Head of Data" } },
    ],
  },
  {
    name: "Group Grove",
    staff: 40,
    facts: [
      { key: "marketing.tool", text: "Klaviyo and Omnisend" },
      { key: "financials.ownership", text: "Owned by Synthetic Brands plc, a listed multi-brand group" },
    ],
    records: [{ type: "retailer", data: { name: "Synthetic Garden Mart", date: TODAY } }],
  },
  { name: "Quiet Acre" },
];

async function seedAll(): Promise<{ sectorId: string; ids: Record<string, string> }> {
  const db = handle.db;
  const sectorId = randomUUID();
  await db.insert(sectors).values({ id: sectorId, name: "Garden ICP e2e" });
  for (const key of ["marketing.tool", "financials.ownership"]) {
    await db.insert(factKeys).values({ key, valueType: "text", description: key, createdBy: "test" }).onConflictDoNothing();
  }
  for (const name of ["retailer", "review", "job_posting", "leader"]) {
    await db.insert(recordTypes).values({ name, description: name, fields: [], naturalKey: ["name"], createdBy: "test" }).onConflictDoNothing();
  }
  const ids: Record<string, string> = {};
  for (const seed of COMPANIES) {
    const companyId = randomUUID();
    ids[seed.name] = companyId;
    await db.insert(companies).values({ id: companyId, source: "manual", name: seed.name, domain: `${seed.name.split(" ")[0]?.toLowerCase()}.example`, country: "United States" });
    await db.insert(sectorCompanies).values({ sectorId, companyId, addedVia: "manual", eligibility: "eligible" });
    await db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "completed" });
    const runId = randomUUID();
    const sourceId = randomUUID();
    await db.insert(researchRuns).values({ id: runId, companyId, kind: "agent", status: "succeeded" });
    await db.insert(sources).values({ id: sourceId, companyId, runId, url: `https://${seed.name}.example/`, finalUrl: `https://brand.example/${companyId.slice(0, 6)}`, collector: "test", status: "ok" });
    if (seed.staff !== undefined) {
      await db.insert(facts).values({
        id: randomUUID(), companyId, runId, key: "financials.employees", valueNum: String(seed.staff), qualifiers: { source: "apollo" },
        sourceIds: [sourceId], confidence: "high", createdBy: "collector:apollo",
      });
    }
    for (const f of seed.facts ?? []) {
      await db.insert(facts).values({
        id: randomUUID(), companyId, runId, key: f.key, valueText: f.text, sourceIds: [sourceId], confidence: "high",
        verification: "verified", quote: f.text, createdBy: "extractor:test",
      });
    }
    let n = 0;
    for (const r of seed.records ?? []) {
      n += 1;
      await db.insert(records).values({
        id: randomUUID(), companyId, type: r.type, naturalKeyHash: String(n), data: r.data, sourceIds: [sourceId],
        verification: "verified", quote: "synthetic", createdBy: "extractor:test",
      });
    }
  }
  return { sectorId, ids };
}

/** A fake judge that says yes to every question with evidence, citing all of it. */
const judge: ClassifierCall = async ({ prompt }) => {
  const answer = (key: string) => {
    const section = prompt.split(`### \`${key}\``)[1]?.split("### ")[0] ?? "";
    const refs = [...section.matchAll(/\[([fr]:[0-9a-f-]+)\]/g)].map((m) => m[1] as string);
    return refs.length > 0
      ? { verdict: "yes", evidence_refs: refs, observation: `${key} shown` }
      : { verdict: "unknown", evidence_refs: [], observation: "no evidence" };
  };
  const json = {
    signals: Object.fromEntries(["channels", "hiring", "revenue_left", "review_pain", "recent_change", "tool_sprawl"].map((k) => [k, answer(k)])),
    exclusions: {
      data_team: answer("data_team"),
      parent_company: { ...answer("parent_company"), own_decision_maker: "no" },
      not_d2c: { verdict: "no", evidence_refs: [], observation: "sells its own products" },
    },
    flags: { tech_team: answer("tech_team") },
  };
  return { json, raw: JSON.stringify(json), usage: USAGE };
};

describe("ICP check end to end (synthetic garden)", () => {
  it("checks every researched company, tiers the contactable ones and writes the sheet", async () => {
    const { sectorId, ids } = await seedAll();
    const { jobId, companies: queued } = await startSectorIcp(handle.db, { sectorId });
    expect(queued).toBe(COMPANIES.length);

    const runner = createSectorRunner(handle.db, {
      pool: 8,
      memAvailableMB: () => null,
      icp: (input) => runIcpCheck(handle.db, { ...input, call: judge }),
    });
    for (let i = 0; i < 20; i += 1) {
      await runner.tick();
      if ((await sectorPreflightStatus(handle.db, jobId)).job.status === "completed") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect((await sectorPreflightStatus(handle.db, jobId)).job.status).toBe("completed");

    const all = await allCheckedRows(handle.db, sectorId);
    const byName = Object.fromEntries(all.map((r) => [r.name, r]));
    expect(all).toHaveLength(COMPANIES.length);
    expect(byName["Bramble & Bough"]).toMatchObject({ status: "contactable", tier: "A", score: 3, layer: 4 });
    expect(byName["Pip & Trowel"]).toMatchObject({ status: "contactable", tier: "B", score: 2, layer: 5 });
    expect(byName["Lone Fern"]).toMatchObject({ status: "watchlist", score: 1 });
    expect(byName["Metric Meadow"]?.status).toBe("excluded");
    expect(byName["Metric Meadow"]?.exclusionReason).toMatch(/^Has a data team/);
    expect(byName["Group Grove"]?.status).toBe("excluded");
    expect(byName["Group Grove"]?.exclusionReason).toMatch(/^Owned by a listed or multi-brand company/);
    expect(byName["Quiet Acre"]).toMatchObject({ status: "research_incomplete" });

    const summary = await sectorTierSummary(handle.db, sectorId);
    expect(summary.byTierLayer).toEqual({ "A/L4": 1, "B/L5": 1 });

    const sheet = await outreachSheetRows(handle.db, sectorId);
    expect(sheet.map((r) => [r.company, r.tier, r.layer])).toEqual([
      ["Bramble & Bough", "A", 4],
      ["Pip & Trowel", "B", 5],
    ]);
    expect(sheet[0]?.companyId).toBe(ids["Bramble & Bough"]);
    expect(sheet[0]?.signalsMet).toEqual(["Sells across channels", "Customer pain in reviews", "Tool sprawl"]);
    expect(sheet[0]?.observations[0]).toMatch(new RegExp(`^Sells across channels \\(${TODAY}\\): channels shown`));
    expect(sheet[1]?.buyerOrder).toMatch(/^Founder\/CEO/);
    const csv = outreachCsv(sheet);
    expect(csv).toContain("Tier A");
    expect(csv).toContain("Tier B");
    expect(csv).not.toContain("Lone Fern");
  }, 60000);
});
