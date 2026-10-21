import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, facts, records, researchRuns } from "../../src/db/schema.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { captureSource } from "../../src/domain/research/sources.js";
import {
  dateVariants,
  normalizeText,
  numberInText,
  stringInText,
  verifyRunExtraction,
} from "../../src/domain/research/grounding.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

describe("grounding matchers", () => {
  it("normalizes case, punctuation and whitespace", () => {
    expect(normalizeText("  Apple,  Inc.\n")).toBe("apple inc");
    expect(stringInText("Apple Inc", "…at APPLE, inc. today…")).toBe(true);
    expect(stringInText("Apple Inc", "apple orchard incorporated")).toBe(false);
  });

  it("matches numbers across commas, currency, decimals and scale words", () => {
    expect(numberInText(1234, "revenue was $1,234")).toBe(true);
    expect(numberInText(4.5, "rated 4.50 stars")).toBe(true);
    expect(numberInText(25, "up 25% year over year")).toBe(true);
    expect(numberInText(1200000, "raised 1.2 million")).toBe(true);
    expect(numberInText(3000, "team of 3k")).toBe(true);
    // Token equality, not substring: 100 must not match 1000.
    expect(numberInText(100, "1000 employees")).toBe(false);
    expect(numberInText(100, "100 employees")).toBe(true);
    expect(numberInText(2019, "founded in 2019")).toBe(true);
    expect(numberInText(2020, "founded in 2019")).toBe(false);
  });

  it("matches dates across renderings", () => {
    expect(dateVariants("2024-05-01")).toContain("may 1 2024");
    expect(stringInText("May 1, 2024", "launched May 1, 2024 in Oslo")).toBe(true);
  });
});

describe("verifyRunExtraction", () => {
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

  async function setup() {
    const [co] = await handle.db
      .insert(companies)
      .values({ id: randomUUID(), source: "manual", name: "Ground Co" })
      .returning({ id: companies.id });
    const companyId = co?.id ?? "";
    const [run] = await handle.db
      .insert(researchRuns)
      .values({ id: randomUUID(), companyId, kind: "agent", status: "succeeded" })
      .returning({ id: researchRuns.id });
    const runId = run?.id ?? "";
    return { companyId, runId };
  }

  async function captured(companyId: string, runId: string, text: string, url?: string): Promise<string> {
    const result = await captureSource(handle.db, {
      companyId,
      runId,
      url: url ?? `http://example.invalid/${randomUUID()}`,
      text,
      via: "browser",
      passages: [text],
      createdBy: "agent:test",
    });
    return result.sourceId;
  }

  it("marks verified, doc_only and unverified without dropping rows", async () => {
    const { companyId, runId } = await setup();
    const rich = await captured(companyId, runId, "Acme Corp employs 1,234 people and was founded in 2019.");
    const thin = await captured(companyId, runId, "Acme Corp homepage.");
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "reviews/summary.md",
      contentMd: [`Revenue is $5.6 million [src:${thin}].`, `Unrelated line [src:${rich}].`].join("\n"),
      sourceIds: [rich, thin],
      createdBy: "agent:test",
    });
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "extractor:reviews",
      facts: [
        { key: "test.employees", value: 1234, sourceIds: [rich], confidence: "high" },
        { key: "test.revenue", value: 5600000, sourceIds: [thin], confidence: "medium" },
        { key: "test.color", value: "chartreuse", sourceIds: [thin], confidence: "low" },
        { key: "test.note", value: "x".repeat(61), sourceIds: [rich], confidence: "low" },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);

    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verified: 1, docOnly: 1, unverified: 2, total: 4 });

    const rows = await handle.db.select().from(facts).where(eq(facts.runId, runId));
    expect(rows).toHaveLength(4);
    const byKey = new Map(rows.map((r) => [r.key, r.verification]));
    expect(byKey.get("test.employees")).toBe("verified");
    expect(byKey.get("test.revenue")).toBe("doc_only");
    expect(byKey.get("test.color")).toBe("unverified");
    expect(byKey.get("test.note")).toBe("unverified");
  });

  it("finds doc lines by cited URL when agents cite inline links", async () => {
    const { companyId, runId } = await setup();
    const url = "http://example.invalid/pricing";
    const src = await captured(companyId, runId, "Pricing page.", url);
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "business_model/notes.md",
      contentMd: `The plan costs $29 (source: ${url}).`,
      sourceIds: [src],
      createdBy: "agent:test",
    });
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "extractor:business_model",
      facts: [{ key: "test.price", value: 29, sourceIds: [src], confidence: "medium" }],
    });
    expect(results.every((r) => r.ok)).toBe(true);
    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verified: 0, docOnly: 1, unverified: 0, total: 1 });
  });

  it("checks record fields and money values field by field", async () => {
    const { companyId, runId } = await setup();
    const src = await captured(companyId, runId, "The Pro plan costs $29 per month. Contact Ada Wells.");
    const results = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "extractor:business_model",
      records: [
        {
          type: "test_plan",
          data: { name: "Pro plan", price: { amount: 29, currency: "USD" }, contact: "Ada Wells" },
          sourceIds: [src],
        },
        {
          type: "test_plan",
          data: { name: "Ghost plan", price: { amount: 999, currency: "USD" }, contact: "Nobody Here" },
          sourceIds: [src],
        },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);

    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verified: 1, unverified: 1, total: 2 });
    const rows = await handle.db.select().from(records).where(eq(records.lastSeenRunId, runId));
    expect(rows).toHaveLength(2);
  });

  it("ignores non-extractor rows", async () => {
    const { companyId, runId } = await setup();
    const src = await captured(companyId, runId, "Acme Corp employs 42 people.");
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "collector:test",
      facts: [{ key: "test.employees", value: 42, sourceIds: [src], confidence: "high" }],
    });
    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts.total).toBe(0);
    const [row] = await handle.db.select().from(facts).where(eq(facts.runId, runId));
    expect(row?.verification).toBe("unverified");
  });
});
