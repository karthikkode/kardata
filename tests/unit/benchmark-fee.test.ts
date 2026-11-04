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
  expect(effectiveFee({ tiers: [tiers[0]!, { ...tiers[1]!, from: 2_000_000 }], method: "marginal", balance: 1_000_000 })).toBeNull();
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

it("preserves conditional amounts and withholds affected or incompletely reviewed scenarios", () => {
  const review = groundFeeReview({ ...response,
    schedules: [{ ...schedule, terms: [
      { field: "minimum_annual_fee", value: "conditional", amount: 12_000, condition: "conditional", evidence: cite(minimum) },
    ] }],
  }, [passage]);
  const fees = summarizeFeeReview(review, [], { complete: true, gaps: [] });
  expect(fees).toMatchObject({ classification: "partial_comparable", at1m: null, at5m: { dollars: 50_000 }, method: null });
  expect(summarizeFeeReview(review, [], { complete: false, gaps: ["missing page"] }).at5m).toBeNull();
});

it("withholds ambiguous, unsupported, and wrap-only peer fees while retaining evidence", () => {
  const raw = { ...response, schedules: [schedule] };
  const wrapOnly = groundFeeReview(raw, [{ ...passage, kind: "wrap" }]);
  const unsupported = groundFeeReview({ ...raw, schedules: [{ ...schedule, tiers: [{ ...schedule.tiers[0], rate_pct: 1.5 }] }] }, [passage]);
  expect(unsupported.issues).toContain("Unsupported tier rate or boundary");
  for (const result of [wrapOnly, unsupported]) expect(summarizeFeeReview(result, [], { complete: true, gaps: [] }).at1m).toBeNull();
  const competing = groundFeeReview({ ...raw, schedules: [schedule, { ...schedule, name: "Other", scope: cite(wrap) }] }, [passage]);
  expect(summarizeFeeReview(competing, [], { complete: true, gaps: [] }).schedules).toHaveLength(2);
  expect(summarizeFeeReview(competing, [], { complete: true, gaps: [] }).at1m).toBeNull();
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
  expect(ground(raw)).toMatchObject({ classification: "tiers_unresolved", at1m: null });
  expect(ground({ ...raw, method: "cliff", methodEvidence: cite(fullBalance) }).at1m?.dollars).toBe(5_000);
  expect(effectiveFee({ tiers: [raw.tiers[0]!], method: "cliff", balance: 1_000_000 })).toBeNull();
});

it("reads beyond the former Item 5 cap and sends independent review to requested evidence", async () => {
  const { reviewBrochures } = await import("../../src/domain/benchmark/brochure-review.js");
  const long = { ...passage, ref: "p8", page: 8, text: "Fund services and conditions. ".repeat(1250) };
  const late = { ...passage, ref: "p9", page: 9, text: "A later section describes outsourced account setup and reconciliation." };
  const prompts: string[] = [];
  const result = await reviewBrochures([passage, long, late], { complete: true, gaps: [] }, async prompt => {
    prompts.push(prompt);
    const provided = (p: Passage) => prompt.includes(`--- Excerpt ${p.ref},`);
    return { ...response, schedules: provided(passage) || prompt.includes("Independently reconcile") ? [schedule] : [],
      inspect: provided(late) ? ["p9"] : [],
      findings: provided(late) ? [{ topic: "operations", interpretation: "outsourced setup", evidence: cite(late.text, "p9") }] : [],
    };
  });
  expect(prompts.length).toBeGreaterThan(2);
  expect(prompts.some(prompt => prompt.includes("Independently reconcile") && prompt.includes(late.text))).toBe(true);
  expect(result.findings).toMatchObject([{ evidence: { page: 9 }, topic: "operations" }]);
  expect(result.at5m?.dollars).toBe(50_000);
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
