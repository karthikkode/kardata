import { expect, it } from "vitest";
import { feePilotSummary } from "../../src/domain/benchmark/fees.js";
import { effectiveFee } from "../../src/domain/benchmark/fee-math.js";
import { groundFeeReview, summarizeFeeReview, type Passage } from "../../src/domain/benchmark/fee-extraction.js";

const tiers = [{ from: 0, to: 1_000_000, rate_pct: 1 }, { from: 1_000_000, to: null, rate_pct: 0.5 }];
it("computes marginal and cliff fees, exact boundaries, open tiers, and minimums", () => {
  expect(effectiveFee({ tiers, method: "marginal", balance: 5_000_000 })).toEqual({ dollars: 30_000, rate_pct: 0.6 });
  expect(effectiveFee({ tiers, method: "cliff", balance: 5_000_000 })).toEqual({ dollars: 25_000, rate_pct: 0.5 });
  expect(effectiveFee({ tiers, method: "cliff", balance: 1_000_000 })).toEqual({ dollars: 10_000, rate_pct: 1 });
  expect(effectiveFee({ tiers, method: "marginal", balance: 1_000_000, minimumAnnualFee: 15_000 })?.dollars).toBe(15_000);
  expect(effectiveFee({ tiers, method: "cliff", balance: 1_000_000, minimumAccountSize: 2_000_000 })).toBeNull();
  expect(effectiveFee({ tiers: [{ from: 0, to: null, rate_pct: 0.5 }], method: "cliff", balance: 1_000_000 })?.dollars).toBe(5_000);
  expect(effectiveFee({ tiers: [tiers[0]!, { ...tiers[1]!, from: 2_000_000 }], method: "marginal", balance: 1_000_000 })?.dollars).toBe(10_000);
});

const fullBalance = "The applicable annual rate is charged on the entire account balance.";
const standard = "Standard individual investment management";
const wrap = "Optional wrap program";
const flat = "Our annual fee is 1% of managed assets.";
const minimum = "An annual minimum of $12,000 may apply if specified in the agreement.";
const noMinimum = "We have no minimum account size.";
const passage: Passage = {
  ref: "p7", text: [standard, wrap, flat, minimum, noMinimum, fullBalance].join("\n"), kind: "firm",
  sourceId: "source", page: 7, documentId: "brochure", date: "2026-03-31",
};
const cite = (quote: string, ref = passage.ref) => ({ quote, ref });
const response = { terms: [], findings: [], gaps: [], inspect: [] };
const schedule = {
  name: "Standard", category: "standard", pricing: "annual_aum", scope: cite(standard),
  method: null, methodEvidence: null, blocksExact: false, conditions: [], terms: [],
  tiers: [{ from: 0, to: null, rate_pct: 1, evidence: cite(flat), from_inclusive: null, to_inclusive: null }],
};

it("retains independent program prices, scope, qualitative terms, and original page citations", () => {
  const review = groundFeeReview({ ...response,
    terms: [
      { field: "minimum_account_size", value: "none", amount: null, condition: "none", evidence: cite(noMinimum) },
      { field: "minimum_annual_fee", value: "unsupported", amount: 111, condition: "recommended", evidence: cite(minimum) },
    ],
    schedules: [schedule, { ...schedule, name: "Wrap", category: "program", scope: cite(wrap) }],
  }, [passage]);
  const fees = summarizeFeeReview(review, [], { complete: true, gaps: [] });
  expect(fees.classification).toBe("comparable");
  expect(fees.at5m?.dollars).toBe(50_000);
  expect(fees.schedules).toHaveLength(2);
  expect(fees.schedules[1]?.scope).toMatchObject({ quote: wrap, sourceId: "source", page: 7 });
  expect(fees.terms.minimum_account_size).toMatchObject([{ value: "none", amount: null }]);
  expect(fees.coverage.gaps).toContain("Unsupported term: minimum_annual_fee");
});

it("preserves posted scenarios and conditional minimums across unrelated review gaps", () => {
  const review = groundFeeReview({ ...response,
    schedules: [{ ...schedule, terms: [
      { field: "minimum_annual_fee", value: "conditional", amount: 12_000, condition: "conditional", evidence: cite(minimum) },
    ] }],
  }, [passage]);
  const fees = summarizeFeeReview(review, [], { complete: true, gaps: [] });
  expect(fees).toMatchObject({ classification: "partial_comparable", at1m: null, at5m: { dollars: 50_000 }, method: null });
  expect(summarizeFeeReview(review, [], { complete: false, gaps: ["missing page"] }).at5m?.dollars).toBe(50_000);
  expect(fees.scenarios?.cliff).toMatchObject({ at1m: { dollars: 10_000 }, at5m: { dollars: 50_000 } });
});

it("withholds ambiguous, unsupported, and wrap-only peer fees while retaining evidence", () => {
  const raw = { ...response, schedules: [schedule] };
  const wrapOnly = groundFeeReview(raw, [{ ...passage, kind: "wrap" }]);
  const unsupported = groundFeeReview({ ...raw, schedules: [{ ...schedule, tiers: [{ ...schedule.tiers[0], rate_pct: 1.5 }] }] }, [passage]);
  expect(unsupported.issues).toContain("Unsupported tier rate or boundary");
  for (const result of [wrapOnly, unsupported]) expect(summarizeFeeReview(result, [], { complete: true, gaps: [] }).at1m).toBeNull();
  const competing = groundFeeReview({ ...raw, schedules: [schedule, { ...schedule, name: "Other", scope: cite(wrap) }] }, [passage]);
  expect(summarizeFeeReview(competing, [], { complete: true, gaps: [] }).schedules).toHaveLength(2);
  expect(summarizeFeeReview(competing, [], { complete: true, gaps: [] }).at1m?.dollars).toBe(10_000);
});

it("stores quoted ranges and caps without making them exact scenarios", () => {
  const quote = "The negotiated annual range is 0.5–1.5% depending on the service.";
  const raw = { ...response, schedules: [{ ...schedule, pricing: "range", tiers: [],
    rateBounds: { lower_pct: 0.5, upper_pct: 1.5, evidence: cite(quote) } }] };
  const fees = summarizeFeeReview(groundFeeReview(raw, [{ ...passage, text: passage.text + "\n" + quote }]), [],
    { complete: true, gaps: [] });
  expect(fees).toMatchObject({ at1m: null, at5m: null, classification: "terms_only",
    schedules: [{ rateBounds: { lower_pct: 0.5, upper_pct: 1.5, evidence: { quote } } }] });
});

it("uses explicit whole-balance wording and retains tiers when the method is unknown", () => {
  const row1 = "Through $999,999.99 at 1%";
  const row2 = "$1,000,000 and above at .5%";
  const text = [passage.text, row1, row2].join("\n");
  const raw = { ...schedule, tiers: [
    { from: 0, to: 999_999.99, rate_pct: 1, from_inclusive: null, to_inclusive: true, evidence: cite(row1) },
    { from: 1_000_000, to: null, rate_pct: 0.5, from_inclusive: true, to_inclusive: null, evidence: cite(row2) },
  ] };
  const ground = (value: unknown) => summarizeFeeReview(groundFeeReview({ ...response, schedules: [value] }, [{ ...passage, text }]), [],
    { complete: true, gaps: [] });
  expect(ground(raw)).toMatchObject({ classification: "primary_scenarios", at1m: null });
  expect(ground({ ...raw, method: "cliff", methodEvidence: cite(fullBalance) }).at1m?.dollars).toBe(5_000);
  expect(effectiveFee({ tiers: [raw.tiers[0]!], method: "cliff", balance: 1_000_000 })).toBeNull();
});

it("reads Item 5 by page without sending later sections to the provider", async () => {
  const { feeItemPassages, reviewBrochures } = await import("../../src/domain/benchmark/brochure-review.js");
  const item = { ...passage, text: ["Item 5 Fees and Compensation", passage.text,
    "Item 6 Performance-Based Fees", "Unrelated material to exclude."].join("\n") };
  const other = { ...passage, ref: "p8", page: 8, text: "Unrelated risk disclosures." };
  const item5 = feeItemPassages([item, other]);
  expect(item5).toMatchObject([{ page: 7, ref: "p7-item5" }]);
  const prompts: string[] = [];
  const result = await reviewBrochures([item, other], { complete: true, gaps: [], item5 }, async prompt => {
    prompts.push(prompt);
    return { ...response, schedules: [{ ...schedule, scope: cite(standard, "p7-item5"),
      tiers: [{ ...schedule.tiers[0], evidence: cite(flat, "p7-item5") }] }] };
  });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).not.toMatch(/Unrelated/);
  expect(result).toMatchObject({ readMode: "item_5", at5m: { dollars: 50_000 }, drops: [] });
});

it("expands only on an appendix reference and retains an omitted first-pass schedule", async () => {
  const { reviewBrochures } = await import("../../src/domain/benchmark/brochure-review.js");
  const item = { ...passage, text: passage.text + "\nSee Appendix A for wrap program pricing." };
  const appendix = { ...passage, ref: "p8", page: 8, text: "Appendix A. The wrap fee is 0.75% of managed assets." };
  const prompts: string[] = [];
  const result = await reviewBrochures([item, appendix], { complete: true, gaps: [], item5: [item] }, async prompt => {
    prompts.push(prompt);
    if (!prompt.includes("explicit edits only")) return { ...response, schedules: [schedule] };
    return { ...response, schedules: [{ ...schedule, category: "program", name: "Wrap",
      scope: cite("Appendix A.", "p8"), tiers: [{ ...schedule.tiers[0], rate_pct: 0.75,
        evidence: cite("The wrap fee is 0.75% of managed assets.", "p8") }] }] };
  });
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).not.toContain(appendix.text);
  expect(prompts[1]).toContain(appendix.text);
  expect(result).toMatchObject({ readMode: "full_fallback", drops: [], at5m: { dollars: 50_000 },
    schedules: [{ role: "primary" }, { role: "scoped", at5m: { dollars: 37_500 } }] });
});

it("accepts only cited physical-page drops, logging every accepted reason", async () => {
  const { reconcileFeeReviews } = await import("../../src/domain/benchmark/brochure-review.js");
  const text = "The prior 1% illustration has been withdrawn and is not a fee schedule.";
  const physical = { ...passage, ref: "p8", page: 8, text };
  const initial = groundFeeReview({ ...response, schedules: [schedule] }, [passage]);
  const decision = { candidate: "s1", action: "drop", replacement: null, reason: "The illustration was withdrawn.", evidence: cite(text, "p8") };
  const revise = (page: Passage, raw: unknown) => reconcileFeeReviews([initial], [
    groundFeeReview({ ...response, schedules: [], decisions: [raw] }, [page]),
  ]);
  expect(revise({ ...physical, page: null }, decision).review.schedules).toHaveLength(1);
  expect(revise({ ...physical, sourceId: "another-filing" }, decision).drops).toEqual([]);
  expect(revise(physical, { ...decision, evidence: cite("invented contradiction", "p8") }).review.schedules).toHaveLength(1);
  expect(revise(physical, decision)).toMatchObject({ review: { schedules: [] },
    drops: [{ schedule: "Standard", reason: decision.reason, evidence: { page: 8, quote: text } }] });
});

it("corrects a grounded candidate without reintroducing an unsupported replacement", async () => {
  const { reconcileFeeReviews } = await import("../../src/domain/benchmark/brochure-review.js");
  const quote = "The amended annual fee for standard individual investment management is 0.8%.";
  const amendment = { ...passage, ref: "p8", page: 8, text: quote };
  const initial = groundFeeReview({ ...response, schedules: [schedule] }, [passage]);
  const edit = { candidate: "s1", action: "correct", replacement: 0, reason: "Amended fee replaces the earlier rate.", evidence: cite(quote, "p8") };
  const replacement = { ...schedule, scope: cite(quote, "p8"),
    tiers: [{ ...schedule.tiers[0], rate_pct: 0.8, evidence: cite(quote, "p8") }] };
  const apply = (candidate: unknown) => reconcileFeeReviews([initial], [
    groundFeeReview({ ...response, schedules: [candidate], decisions: [edit] }, [amendment]),
  ]);
  expect(apply(replacement)).toMatchObject({ review: { schedules: [{ tiers: [{ rate_pct: 0.8 }] }] },
    drops: [], corrections: [{ candidate: "s1", reason: edit.reason, evidence: { page: 8 } }] });
  expect(apply({ ...replacement, tiers: [] })).toMatchObject({ review: { schedules: [{ tiers: [{ rate_pct: 1 }] }] },
    drops: [], corrections: [] });
});

it("includes failed firms and unmetered attempts in the pilot result", () => {
  const row = { companyId: "fixture", elapsedMs: 1000, inputTokens: 100, outputTokens: 25 };
  const report = feePilotSummary([
    { ...row, outcome: "failed", attempts: 3, retries: 2, unmeteredAttempts: 1 },
    { ...row, outcome: "done", attempts: 2, retries: 1, unmeteredAttempts: 0 },
  ], 10, 1000);
  expect(report).toMatchObject({ meanRetries: 1.5, failures: 1, missingTokenReports: 1,
    projected: { companies: 10, inputTokens: 1000, outputTokens: 250, elapsedMs: 5000, tokensAreLowerBound: true } });
});

it("makes one targeted read for pages missed by the fallback and reports any still unavailable", async () => {
  const { reviewBrochures } = await import("../../src/domain/benchmark/brochure-review.js");
  const filler = { ...passage, ref: "p1", page: 1, text: "Annual management fee. " + "Program information ".repeat(1100) };
  const table = { ...passage, kind: "wrap" as const, ref: "p12", page: 12, text: "Optional wrap program\n" + flat + "\n" + "Conditions ".repeat(400) };
  const prompts: string[] = [];
  const result = await reviewBrochures([filler, table], { complete: true, gaps: [] }, async prompt => {
    prompts.push(prompt);
    if (!prompt.includes("--- Excerpt p12,")) return { ...response, schedules: [], inspect: ["p12", "p14"] };
    return { ...response, schedules: [{ ...schedule, category: "program", name: "Wrap",
      scope: cite(wrap, "p12"), tiers: [{ ...schedule.tiers[0], evidence: cite(flat, "p12") }] }], inspect: ["p15"] };
  });
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("--- Excerpt p12,");
  expect(prompts[1]).not.toContain("--- Excerpt p1,");
  expect(result).toMatchObject({ readMode: "full_fallback",
    requestedExcerpts: { supplied: ["p12"], unavailable: ["p14", "p15"] },
    schedules: [{ role: "scoped", at1m: { dollars: 10_000 }, at5m: { dollars: 50_000 } }] });
  expect(result.coverage.gaps).toContain("Requested fee excerpts not supplied after bounded fallback: p14, p15");
});
