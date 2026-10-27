import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, facts, researchRuns, sources, type ResearchRun } from "../../src/db/schema.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { scorecard } from "../../src/domain/research/scorecard.js";
import {
  type ExtractorCall,
  extractRun,
  gatherAreaNotes,
  assertExtractionComplete,
  runExtraction,
  validateExtractionJson,
  writeExtraction,
} from "../../src/runs/extract.js";
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

const SID_A = randomUUID();
const SID_B = randomUUID();
const ALLOWED = [SID_A, SID_B];

function factJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "marketing.channel_active",
    value: true,
    value_json: null,
    unit: null,
    currency: null,
    qualifiers: [{ name: "channel", value: "tiktok" }],
    as_of: null,
    source_ids: [SID_A],
    confidence: "high",
    note: null,
    quote: "quoted spend span",
    quote_source_id: SID_A,
    ...overrides,
  };
}

function findingJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    claim: "Paid mix is TikTok-first.",
    detail: null,
    source_ids: [SID_A],
    record_refs: null,
    confidence: "medium",
    status: "supported",
    quote: "quoted finding span",
    quote_source_id: SID_A,
    ...overrides,
  };
}

function extractionJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { facts: [], records: [], findings: [], ...overrides };
}

describe("validateExtractionJson", () => {
  it("decodes the strict-schema encodings", () => {
    const validated = validateExtractionJson(
      "marketing",
      ALLOWED,
      extractionJson({
        facts: [
          factJson({ key: "marketing.spend", value: 1200, currency: "USD" }),
          factJson({
            key: "marketing.channels",
            value: null,
            value_json: JSON.stringify(["tiktok", "meta"]),
            qualifiers: [{ name: "platform", value: "paid" }],
            as_of: "2026-01",
            note: "n",
          }),
        ],
        records: [
          {
            type: "ad_creative",
            data: JSON.stringify({ headline: "Glow", url: "https://x.example/a" }),
            source_ids: [SID_B],
            quote: "",
            quote_source_id: "",
          },
        ],
        findings: [findingJson({ detail: "spend rising", record_refs: [0] })],
      }),
    );
    expect(validated.droppedOutOfList).toBe(0);
    expect(validated.droppedInvalid).toBe(0);
    expect(validated.facts[0]?.value).toEqual({ amount: 1200, currency: "USD" });
    expect(validated.facts[1]?.value).toEqual(["tiktok", "meta"]);
    expect(validated.facts[1]?.qualifiers).toEqual({ platform: "paid" });
    expect(validated.facts[1]?.note).toBe("n");
    expect(validated.records[0]?.data).toEqual({ headline: "Glow", url: "https://x.example/a" });
    expect(validated.records[0]?.naturalKey).toBeUndefined();
    expect(validated.findings[0]).toMatchObject({
      claim: "Paid mix is TikTok-first.",
      detail: "spend rising",
      recordRefs: [0],
    });
  });

  it("keeps natural_key fields but drops values that name no data field", () => {
    const validated = validateExtractionJson(
      "marketing",
      ALLOWED,
      extractionJson({
        records: [
          {
            type: "program",
            data: JSON.stringify({ name: "Club", url: "https://x.example/c" }),
            source_ids: [SID_A],
            natural_key: ["name", "club-slug"],
            quote: "",
            quote_source_id: "",
          },
          {
            type: "program",
            data: JSON.stringify({ name: "Other" }),
            source_ids: [SID_A],
            natural_key: ["other-slug"],
            quote: "",
            quote_source_id: "",
          },
        ],
      }),
    );
    expect(validated.droppedInvalid).toBe(0);
    expect(validated.records[0]?.naturalKey).toEqual(["name"]);
    expect(validated.records[1]?.naturalKey).toBeUndefined();
  });

  it("drops out-of-list citations and counts them separately", () => {
    const validated = validateExtractionJson(
      "marketing",
      ALLOWED,
      extractionJson({
        facts: [factJson(), factJson({ key: "marketing.other", source_ids: [randomUUID()] })],
        records: [
          {
            type: "ad_creative",
            data: JSON.stringify({ a: 1 }),
            source_ids: [randomUUID()],
            quote: "",
            quote_source_id: "",
          },
        ],
        findings: [findingJson({ source_ids: [randomUUID()] })],
      }),
    );
    expect(validated.facts).toHaveLength(1);
    expect(validated.records).toHaveLength(0);
    expect(validated.findings).toHaveLength(0);
    expect(validated.droppedOutOfList).toBe(3);
    expect(validated.droppedInvalid).toBe(0);
  });

  it("passes quotes through and drops invented quote ids", () => {
    const validated = validateExtractionJson(
      "marketing",
      ALLOWED,
      extractionJson({
        facts: [
          factJson({ quote: "spend was $1,200", quote_source_id: SID_A }),
          factJson({ key: "marketing.other", quote: "x", quote_source_id: randomUUID() }),
          factJson({ key: "marketing.bare", quote: "", quote_source_id: "" }),
        ],
      }),
    );
    expect(validated.droppedOutOfList).toBe(1);
    expect(validated.droppedInvalid).toBe(0);
    expect(validated.facts).toHaveLength(2);
    expect(validated.facts[0]).toMatchObject({ quote: "spend was $1,200", quoteSourceId: SID_A });
    expect(validated.facts[1]).not.toHaveProperty("quote");
    expect(validated.facts[1]).not.toHaveProperty("quoteSourceId");
  });

  it("drops malformed items and malformed envelopes", () => {
    const validated = validateExtractionJson(
      "marketing",
      ALLOWED,
      extractionJson({
        facts: [
          factJson({ key: "   " }),
          factJson({ key: "bad.json", value: null, value_json: "{oops" }),
          factJson({ key: "no.sources", source_ids: [] }),
        ],
        records: [
          { type: "ad_creative", data: "[1,2]", source_ids: [SID_A], quote: "", quote_source_id: "" },
          { type: "", data: JSON.stringify({ a: 1 }), source_ids: [SID_A], quote: "", quote_source_id: "" },
        ],
        findings: [findingJson({ claim: "" })],
      }),
    );
    expect(validated.droppedOutOfList).toBe(0);
    expect(validated.droppedInvalid).toBe(6);

    const envelope = validateExtractionJson("marketing", ALLOWED, "junk");
    expect(envelope.facts).toHaveLength(0);
    expect(envelope.droppedInvalid).toBe(1);
  });
});

async function makeCompany(): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name: "Extract Co" })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeAgentRun(companyId: string): Promise<ResearchRun> {
  const started = new Date(Date.now() - 30 * 60 * 1000);
  const [row] = await handle.db
    .insert(researchRuns)
    .values({
      id: randomUUID(),
      companyId,
      kind: "agent",
      status: "succeeded",
      batchId: randomUUID(),
      promptVersion: "v1.1",
      startedAt: started,
      finishedAt: new Date(started.getTime() + 20 * 60 * 1000),
      agentUsage: {
        model: "m",
        inputTokens: 1000,
        outputTokens: 100,
        cachedTokens: 500,
        reasoningTokens: 10,
        calls: 3,
        childrenIncluded: true,
      },
    })
    .returning();
  if (!row) throw new Error("no run row");
  return row;
}

async function makeSource(companyId: string, runId: string, url: string): Promise<string> {
  const [row] = await handle.db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId,
      runId,
      url,
      finalUrl: url,
      collector: "test",
      status: "ok",
      httpStatus: 200,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("no source row");
  return row.id;
}

async function seedNotes(companyId: string, runId: string, sourceId: string): Promise<void> {
  await saveDocument(handle.db, {
    companyId,
    runId,
    path: "marketing/notes.md",
    contentMd: "# Marketing\n\nTikTok ads live [s1].",
    sourceIds: [sourceId],
    createdBy: `agent:${runId}`,
  });
  await saveDocument(handle.db, {
    companyId,
    runId,
    path: "product/notes.md",
    contentMd: "# Product\n\nHero SKU is Glow Cream [s1].",
    sourceIds: [sourceId],
    createdBy: `agent:${runId}`,
  });
  // An owner doc must never feed the extractor.
  await saveDocument(handle.db, {
    companyId,
    runId,
    path: "marketing/owner-note.md",
    contentMd: "Owner scratch.",
    sourceIds: [sourceId],
    createdBy: "owner",
  });
}

function fakeCaller(outputs: Record<string, unknown>): ExtractorCall & { calls: string[] } {
  const calls: string[] = [];
  const call = (async (input: { runId: string; area: string; prompt: string }) => {
    calls.push(input.area);
    return {
      json: (outputs[input.area] ?? { facts: [], records: [], findings: [] }) as unknown,
      usage: { model: "fake", inputTokens: 10, outputTokens: 5, cachedTokens: 0, calls: 1 },
    };
  }) as ExtractorCall & { calls: string[] };
  call.calls = calls;
  return call;
}

function marketingOutput(sourceId: string): Record<string, unknown> {
  return {
    facts: [
      {
        key: "marketing.channel_active",
        value: true,
        value_json: null,
        unit: null,
        currency: null,
        qualifiers: [{ name: "channel", value: "tiktok" }],
        as_of: null,
        source_ids: [sourceId],
        confidence: "high",
        note: null,
        quote: "TikTok ads live",
        quote_source_id: sourceId,
      },
    ],
    records: [
      {
        type: "test_ad",
        data: JSON.stringify({ headline: "Glow" }),
        source_ids: [sourceId],
        quote: "Hero SKU is Glow Cream",
        quote_source_id: sourceId,
      },
    ],
    findings: [
      {
        claim: "Paid mix is TikTok-first.",
        detail: null,
        source_ids: [sourceId],
        record_refs: [0, 7],
        confidence: "medium",
        status: "supported",
        quote: "Paid mix is TikTok-first",
        quote_source_id: sourceId,
      },
    ],
  };
}

describe("gatherAreaNotes", () => {
  it("collects only current agent docs for the area", async () => {
    const companyId = await makeCompany();
    const run = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, run.id, "https://example.com/");
    await seedNotes(companyId, run.id, sourceId);

    const uncited = await makeSource(companyId, run.id, "https://example.com/uncited");
    const scoped = await gatherAreaNotes(handle.db, run.id, "marketing");
    expect(scoped.notes).toContain("TikTok ads live");
    expect(scoped.notes).not.toContain("Glow Cream");
    expect(scoped.notes).not.toContain("Owner scratch");
    expect(scoped.sourceIds).toEqual([sourceId, uncited]);
    expect(scoped.notes).toContain("https://example.com/uncited");

    const all = await gatherAreaNotes(handle.db, run.id, null);
    expect(all.notes).toContain("TikTok ads live");
    expect(all.notes).toContain("Glow Cream");
    expect(all.notes).not.toContain("Owner scratch");
  });
});

describe("runExtraction with a fake harness", () => {
  it("writes extractor-attributed rows visible in scorecard extractor.* only", async () => {
    const companyId = await makeCompany();
    const run = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, run.id, "https://example.com/");
    await seedNotes(companyId, run.id, sourceId);
    const call = fakeCaller({ marketing: marketingOutput(sourceId) });

    const outcome = await runExtraction(handle.db, run, { call });
    const marketing = outcome.areas.find((a) => a.area === "marketing");
    expect(marketing?.error).toBeNull();
    expect(marketing).toMatchObject({ writtenFacts: 1, writtenRecords: 1, writtenFindings: 1 });
    // 7 areas plus synthesis, each with one harness call.
    expect(outcome.areas).toHaveLength(8);
    expect(call.calls).toHaveLength(8);

    const factRows = await handle.db
      .select({ key: facts.key, createdBy: facts.createdBy, quote: facts.quote, quoteSourceId: facts.quoteSourceId })
      .from(facts)
      .where(eq(facts.runId, run.id));
    expect(factRows).toEqual([
      {
        key: "marketing.channel_active",
        createdBy: "extractor:marketing",
        quote: "TikTok ads live",
        quoteSourceId: sourceId,
      },
    ]);

    const card = await scorecard(handle.db, { runIds: [run.id] });
    const scored = card.runs[0];
    expect(scored?.agent.facts).toBe(0);
    expect(scored?.agent.findings).toBe(0);
    expect(scored?.extractor.facts).toBe(1);
    expect(scored?.extractor.recordsByType).toEqual({ test_ad: 1 });
    expect(scored?.extractor.findings).toBe(1);
    expect(card.totals.extractor.facts).toBe(1);
  });

  it("records harness failures on the area and continues", async () => {
    const companyId = await makeCompany();
    const run = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, run.id, "https://example.com/");
    await seedNotes(companyId, run.id, sourceId);
    const failing: ExtractorCall = async (input) => {
      if (input.area === "marketing") throw new Error("container exploded");
      return { json: { facts: [], records: [], findings: [] }, usage: undefined };
    };
    const outcome = await runExtraction(handle.db, run, { call: failing });
    expect(outcome.areas.find((a) => a.area === "marketing")?.error).toContain("container exploded");
    expect(outcome.areas.find((a) => a.area === "product")?.error).toBeNull();
    expect(() => assertExtractionComplete(outcome)).toThrow(/extraction incomplete: 1 of \d+ area calls failed \(marketing\)/);
  });

  it("retries a stalled call once and keeps the second answer", async () => {
    const companyId = await makeCompany();
    const run = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, run.id, "https://example.com/");
    await seedNotes(companyId, run.id, sourceId);
    const tries: Record<string, number> = {};
    const flaky: ExtractorCall = async (input) => {
      tries[input.area] = (tries[input.area] ?? 0) + 1;
      if (tries[input.area] === 1) throw new Error("extraction container exited 143: (stall)");
      return { json: { facts: [], records: [], findings: [] }, usage: undefined };
    };
    const outcome = await runExtraction(handle.db, run, { call: flaky });
    expect(outcome.areas.every((a) => a.error === null)).toBe(true);
    expect(Object.values(tries).every((n) => n === 2)).toBe(true);
    expect(() => assertExtractionComplete(outcome)).not.toThrow();
  });
});

describe("writeExtraction", () => {
  it("captures domain rejection reasons", async () => {
    const companyId = await makeCompany();
    const run = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, run.id, "https://example.com/");
    const counts = await writeExtraction(handle.db, companyId, run.id, "business_model", {
      facts: [
        {
          key: "business_model.subscription",
          value: "not-a-bool",
          sourceIds: [sourceId],
          confidence: "high",
        },
      ],
      records: [],
      findings: [],
      droppedOutOfList: 0,
      droppedInvalid: 0,
    });
    expect(counts).toMatchObject({ writtenFacts: 0, rejected: 1 });
    expect(counts.rejections).toHaveLength(1);
    expect(counts.rejections[0]).toContain("business_model.subscription");
  });
});

describe("extractRun", () => {
  it("extracts, preserves run status, restores phase, merges usage", async () => {
    const companyId = await makeCompany();
    const run = await makeAgentRun(companyId);
    const sourceId = await makeSource(companyId, run.id, "https://example.com/");
    await seedNotes(companyId, run.id, sourceId);
    const call = fakeCaller({ marketing: marketingOutput(sourceId) });

    const result = await extractRun(handle.db, run.id, { call });
    expect(result.areas).toHaveLength(8);
    expect(result.usage).toMatchObject({ inputTokens: 80, outputTokens: 40, calls: 8 });

    const [updated] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, run.id));
    expect(updated?.status).toBe("succeeded");
    expect(updated?.agentPhase).toBeNull();
    expect(updated?.agentUsage).toMatchObject({ inputTokens: 1080, calls: 11 });
  });

  it("rejects non-agent and active runs", async () => {
    const companyId = await makeCompany();
    const [collect] = await handle.db
      .insert(researchRuns)
      .values({ id: randomUUID(), companyId, kind: "collect", status: "succeeded" })
      .returning({ id: researchRuns.id });
    await expect(extractRun(handle.db, collect?.id ?? "", { call: fakeCaller({}) })).rejects.toThrow(
      "not an agent run",
    );
    const [active] = await handle.db
      .insert(researchRuns)
      .values({ id: randomUUID(), companyId, kind: "agent", status: "running" })
      .returning({ id: researchRuns.id });
    await expect(extractRun(handle.db, active?.id ?? "", { call: fakeCaller({}) })).rejects.toThrow(
      "still running",
    );
  });
});
