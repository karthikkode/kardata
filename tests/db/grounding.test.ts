import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, facts, records, researchRuns } from "../../src/db/schema.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { addFinding } from "../../src/domain/research/findings.js";
import { upsertRecords } from "../../src/domain/research/records.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { captureSource } from "../../src/domain/research/sources.js";
import {
  dateVariants,
  factCheckables,
  factValueKind,
  recordHardConsistent,
  normalizeText,
  normalizeQuote,
  numberInText,
  parseLocalizedNumber,
  quoteInText,
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

  it("parses EU decimals and thousands separators", () => {
    expect(parseLocalizedNumber("80,00")).toBe(80);
    expect(parseLocalizedNumber("1.234,56")).toBe(1234.56);
    expect(parseLocalizedNumber("1,234.56")).toBe(1234.56);
    expect(parseLocalizedNumber("1,234")).toBe(1234);
    expect(parseLocalizedNumber("1,5")).toBe(1.5);
    expect(numberInText(80, "price 80,00 €")).toBe(true);
    expect(numberInText(108.9, "$108.90")).toBe(true);
    expect(numberInText(93000, "sold 93 000.")).toBe(true);
    // Bare adjacent numbers are not space thousands.
    expect(numberInText(100, "100 200")).toBe(true);
    expect(numberInText(100200, "100 200")).toBe(false);
  });

  it("matches k/M suffixes but not unit words", () => {
    expect(numberInText(1200000, "raised 1.2M")).toBe(true);
    expect(numberInText(100000, "100 k users")).toBe(true);
    expect(numberInText(2000000000, "worth 2 billions")).toBe(true);
    expect(numberInText(100, "100 km away")).toBe(true);
    expect(numberInText(100000, "100 km away")).toBe(false);
  });

  it("matches ranges and percentages without tripping on ISO dates", () => {
    expect(numberInText(95, "conversion 93–97%")).toBe(true);
    expect(numberInText(50, "rated 93-97")).toBe(false);
    expect(numberInText(0.25, "rate 25%")).toBe(true);
    expect(numberInText(25, "rate 25%")).toBe(true);
    expect(numberInText(1000, "launched 2020-01-15")).toBe(false);
    expect(numberInText(15, "launched 2020-01-15")).toBe(true);
  });

  it("splits numeric phrases into number plus currency/unit words", () => {
    expect(factCheckables({ valueText: "100 employees" })).toEqual([
      { kind: "number", num: 100 },
      { kind: "string", text: "employees" },
    ]);
    expect(factCheckables({ valueText: "$25" })).toEqual([{ kind: "number", num: 25 }]);
    expect(factCheckables({ valueText: "USD 25" })).toEqual([
      { kind: "number", num: 25 },
      { kind: "string", text: "USD" },
    ]);
    expect(factCheckables({ valueJson: { amount: 29, currency: "USD" } })).toEqual([
      { kind: "number", num: 29 },
      { kind: "string", text: "USD" },
    ]);
  });

  it("checks record hard claims; string labels are free and urls skipped", () => {
    const text = "The Pro plan costs $29 per month. Contact Ada Wells.";
    expect(recordHardConsistent({ name: "Pro plan", price: { amount: 29, currency: "USD" } }, text)).toBe(true);
    // Labels never count (synthesis), urls are plumbing: no hard claims at all.
    expect(recordHardConsistent({ name: "Ghost plan", url: "https://example.invalid/ghost" }, text)).toBe(true);
    // A wrong number fails.
    expect(recordHardConsistent({ name: "Pro plan", price: { amount: 999, currency: "USD" } }, text)).toBe(false);
    // So does an unverifiable currency.
    expect(recordHardConsistent({ name: "Pro plan", price: { amount: 29, currency: "JPY" } }, text)).toBe(false);
  });

  it("classifies fact value kinds", () => {
    expect(factValueKind({ valueNum: "42" })).toBe("number");
    expect(factValueKind({ valueDate: "2024-05-01" })).toBe("date");
    expect(factValueKind({ valueText: "red" })).toBe("short_text");
    expect(factValueKind({ valueText: "x".repeat(61) })).toBe("long_text");
    expect(factValueKind({ valueBool: true })).toBe("bool");
    expect(factValueKind({ valueJson: { amount: 29, currency: "USD" } })).toBe("money");
    expect(factValueKind({ valueJson: ["a"] })).toBe("json");
  });

  it("matches quotes across case, quotes and dashes", () => {
    expect(normalizeQuote("  “Glow” — she said\n")).toBe('"glow" - she said');
    expect(quoteInText("“Glow,” she said", '... "GLOW," SHE said ...')).toBe(true);
    expect(quoteInText("93-97", "rated 93–97 overall")).toBe(true);
    expect(quoteInText("tiktok ads live", "TikTok ads live [s1].")).toBe(true);
    expect(quoteInText("", "anything")).toBe(false);
    expect(quoteInText("paraphrased claim", "the original wording")).toBe(false);
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

  it("marks verified, doc_only, mismatch and unverified without dropping rows", async () => {
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
        { key: "test.employees", value: 1234, sourceIds: [rich], confidence: "high", quote: "employs 1,234 people", quoteSourceId: rich },
        { key: "test.revenue", value: 5600000, sourceIds: [thin], confidence: "medium", quote: "Revenue is $5.6 million", quoteSourceId: thin },
        { key: "test.color", value: "chartreuse", sourceIds: [thin], confidence: "low", quote: "the banner is chartreuse", quoteSourceId: thin },
        { key: "test.wrong", value: 9999, sourceIds: [rich], confidence: "low", quote: "employs 1,234 people", quoteSourceId: rich },
        { key: "test.note", value: "x".repeat(61), sourceIds: [rich], confidence: "low" },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);

    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verified: 1, docOnly: 1, mismatch: 2, unverified: 1, total: 5 });

    const rows = await handle.db.select().from(facts).where(eq(facts.runId, runId));
    expect(rows).toHaveLength(5);
    const byKey = new Map(rows.map((r) => [r.key, r.verification]));
    expect(byKey.get("test.employees")).toBe("verified");
    expect(byKey.get("test.revenue")).toBe("doc_only");
    expect(byKey.get("test.color")).toBe("quote_mismatch");
    expect(byKey.get("test.wrong")).toBe("quote_mismatch");
    expect(byKey.get("test.note")).toBe("unverified");
  });

  it("matches quotes in agent documents without any citation link", async () => {
    const { companyId, runId } = await setup();
    const url = "http://example.invalid/pricing";
    const src = await captured(companyId, runId, "Pricing page.", url);
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "business_model/notes.md",
      // No citation anywhere: verbatim agent prose is enough for doc_only.
      contentMd: `The plan costs $29, billed monthly.`,
      sourceIds: [],
      createdBy: "agent:test",
    });
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "extractor:business_model",
      facts: [{ key: "test.price", value: 29, sourceIds: [src], confidence: "medium", quote: "The plan costs $29", quoteSourceId: src }],
    });
    expect(results.every((r) => r.ok)).toBe(true);
    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verified: 0, docOnly: 1, mismatch: 0, unverified: 0, total: 1 });
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
          quote: "The Pro plan costs $29 per month. Contact Ada Wells.",
          quoteSourceId: src,
        },
        {
          type: "test_plan",
          data: { name: "Ghost plan", price: { amount: 999, currency: "USD" }, contact: "Nobody Here" },
          sourceIds: [src],
          quote: "The Ghost plan costs $999.",
          quoteSourceId: src,
        },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);

    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verified: 1, mismatch: 1, total: 2 });
    const rows = await handle.db.select().from(records).where(eq(records.lastSeenRunId, runId));
    expect(rows).toHaveLength(2);
  });

  it("verifies extractor findings by quote match", async () => {
    const { companyId, runId } = await setup();
    const src = await captured(companyId, runId, "Acme Corp employs 1,234 people and was founded in 2019.");
    await addFinding(handle.db, {
      companyId,
      runId,
      area: "reviews",
      claim: "Headcount is over a thousand.",
      sourceIds: [src],
      confidence: "high",
      status: "supported",
      createdBy: "extractor:synthesis",
      quote: "employs 1,234 people",
      quoteSourceId: src,
    });
    await addFinding(handle.db, {
      companyId,
      runId,
      area: "reviews",
      claim: "Something unquoted.",
      sourceIds: [src],
      confidence: "low",
      status: "supported",
      createdBy: "extractor:synthesis",
    });
    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verified: 1, unverified: 1, total: 2 });
  });

  it("upgrades doc_only to verified_value when the value is in the cited source", async () => {
    const { companyId, runId } = await setup();
    const src = await captured(companyId, runId, "The Pro plan costs $29 per month, billed annually.");
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "business_model/notes.md",
      contentMd: `Plan pricing: costs $29 monthly, enterprise costs $999 yearly [src:${src}].`,
      sourceIds: [src],
      createdBy: "agent:test",
    });
    const results = await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "extractor:business_model",
      facts: [
        // Quote lives only in the agent doc, but 29 is in the source text.
        { key: "test.price", value: 29, sourceIds: [src], confidence: "medium", quote: "costs $29 monthly", quoteSourceId: src },
        // Same shape, but 999 is nowhere in the source: stays doc_only.
        { key: "test.ghost", value: 999, sourceIds: [src], confidence: "medium", quote: "costs $999 yearly", quoteSourceId: src },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);
    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verifiedValue: 1, docOnly: 1, total: 2 });
    const rows = await handle.db.select().from(facts).where(eq(facts.runId, runId));
    const byKey = new Map(rows.map((r) => [r.key, r.verification]));
    expect(byKey.get("test.price")).toBe("verified_value");
    expect(byKey.get("test.ghost")).toBe("doc_only");
  });

  it("upgrades records on hard claims in the source, never findings", async () => {
    const { companyId, runId } = await setup();
    const src = await captured(companyId, runId, "The Pro plan costs $29 per month. Contact Ada Wells.");
    await saveDocument(handle.db, {
      companyId,
      runId,
      path: "business_model/notes.md",
      contentMd: `Pro plan: $29 per month [src:${src}].`,
      sourceIds: [src],
      createdBy: "agent:test",
    });
    const results = await upsertRecords(handle.db, {
      companyId,
      runId,
      createdBy: "extractor:business_model",
      records: [
        {
          type: "test_plan",
          data: { name: "Pro plan", price: { amount: 29, currency: "USD" } },
          sourceIds: [src],
          quote: "Pro plan: $29 per month",
          quoteSourceId: src,
        },
      ],
    });
    expect(results.every((r) => r.ok)).toBe(true);
    await addFinding(handle.db, {
      companyId,
      runId,
      area: "reviews",
      claim: "Pricing noted.",
      sourceIds: [src],
      confidence: "medium",
      status: "supported",
      createdBy: "extractor:synthesis",
      quote: "Pro plan: $29 per month",
      quoteSourceId: src,
    });
    const counts = await verifyRunExtraction(handle.db, runId);
    expect(counts).toMatchObject({ verifiedValue: 1, docOnly: 1, total: 2 });
    const [record] = await handle.db.select().from(records).where(eq(records.lastSeenRunId, runId));
    expect(record?.verification).toBe("verified_value");
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
