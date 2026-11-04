import { expect, it } from "vitest";
import { groundFeeReview, summarizeFeeReview, type Passage } from "../../src/domain/benchmark/fee-extraction.js";
import { effectiveFee } from "../../src/domain/benchmark/fee-math.js";

const quote = (text: string) => ({ ref: "item-5", quote: text });
const scope = "Standard individual investment management.";
const marginal = "The rates apply to successive portions of the account.";
const rows = [
  { from: 0, to: 999_999, rate_pct: 1, evidence: quote("Up to $999,999: 1%.") },
  { from: 1_000_000, to: 4_999_999, rate_pct: 0.9, evidence: quote("$1,000,000–$4,999,999: 0.9%.") },
  { from: 5_000_000, to: null, rate_pct: 0.5, evidence: quote("$5,000,000 and above: 0.5%.") },
].map(row => ({ ...row, from_inclusive: true, to_inclusive: true }));
const standard = {
  name: "Individual investment management", category: "standard", pricing: "annual_aum",
  scope: quote(scope), method: null, methodEvidence: null, tiers: rows, terms: [], conditions: [], blocksExact: false,
};

function summarize(schedules: unknown[], more: string[] = [], complete = true) {
  const passage: Passage = {
    kind: "firm", ref: "item-5", text: [scope, marginal, ...rows.map(row => row.evidence.quote), ...more].join("\n"),
    sourceId: "source", page: 5, documentId: "document", date: "2026-03-31",
  };
  const review = groundFeeReview({ schedules, terms: [], findings: [], inspect: [], gaps: [] }, [passage]);
  return summarizeFeeReview(review, [], { complete, gaps: [] });
}

it("keeps a primary individual schedule and computes each scoped price independently", () => {
  const wrapScope = "Optional wrap fee program.";
  const wrapPrice = "The annual wrap charge is 1.5%.";
  const institutionalScope = "Separately negotiated institutional services.";
  const fees = summarize([
    { ...standard, name: "Optional wrap", category: "program", scope: quote(wrapScope),
      tiers: [{ ...rows[0], to: null, rate_pct: 1.5, evidence: quote(wrapPrice) }] },
    { ...standard, method: "marginal", methodEvidence: quote(marginal) },
    { ...standard, name: "Institutional", category: "institutional", pricing: "negotiated",
      scope: quote(institutionalScope), tiers: [] },
  ], [wrapScope, wrapPrice, institutionalScope], false);
  expect(fees.primaryScheduleIndex).toBe(1);
  expect(fees.coverage.complete).toBe(false);
  expect(fees.at1m?.dollars).toBe(10_000);
  expect(fees.schedules).toMatchObject([
    { role: "scoped", scopeType: "wrap", at1m: { dollars: 15_000 }, at5m: { dollars: 75_000 } },
    { role: "primary", scopeType: "standard" },
    { role: "scoped", scopeType: "institutional", scenarios: { marginal: null, cliff: null } },
  ]);
});

it("returns marginal and whole-account alternatives without choosing a tier method", () => {
  const fees = summarize([standard]);
  expect(fees).toMatchObject({
    classification: "primary_scenarios", at1m: null, at5m: null, method: null, flags: ["tier_method_unclear"],
    scenarios: {
      marginal: { at1m: { dollars: 10_000 }, at5m: { dollars: 46_000 } },
      cliff: { at1m: { dollars: 9_000 }, at5m: { dollars: 25_000 } },
    },
  });
});

it("prefers a grounded table over a descriptive schedule with the same standard scope", () => {
  const descriptive = { ...standard, name: "Negotiated alternatives", pricing: "negotiated", tiers: [] };
  const priced = { ...standard, method: "marginal", methodEvidence: quote(marginal) };
  const fees = summarize([descriptive, priced]);
  expect(fees.primaryScheduleIndex).toBe(1);
  expect(fees.at5m?.dollars).toBe(46_000);
  expect(summarize([priced, { ...priced, name: "Same posted terms" }]).primaryScheduleIndex).toBe(0);

  const conflicting = "Up to $999,999: 1.5%.";
  const tied = summarize([priced, { ...priced, name: "Conflicting rates", tiers: [
    { ...rows[0], rate_pct: 1.5, evidence: quote(conflicting) }, ...rows.slice(1),
  ] }], [conflicting]);
  expect(tied.primaryScheduleIndex).toBeNull();
  expect(tied.flags).toContain("primary_scope_unclear");
  expect(tied.schedules.map(schedule => schedule.at1m?.dollars)).toEqual([10_000, 14_999.99]);
});

it("localizes a malformed upper boundary and keeps exact calculations below it", () => {
  const tiers = [{ from: 0, to: 1_000_000, rate_pct: 1 }, { from: 1_000_000, to: 5_000_000, rate_pct: 0.5 },
    { from: 5_000_000.01, to: 5_000_000, rate_pct: 0.25, from_inclusive: true }];
  expect(effectiveFee({ tiers, balance: 1_000_000, method: "marginal" })?.dollars).toBe(10_000);
  expect(effectiveFee({ tiers, balance: 5_000_000, method: "marginal" })?.dollars).toBe(30_000);
  expect(effectiveFee({ tiers, balance: 5_000_000, method: "cliff" })?.dollars).toBe(25_000);
  expect(effectiveFee({ tiers, balance: 6_000_000, method: "marginal" })).toBeNull();
});

it("computes unaffected scenarios when only the upper tier's evidence fails", () => {
  const bounded = "Over $1,000,000 through $5,000,000: 0.5%.";
  const first = "Up to $1,000,000: 1%.";
  const upper = "From $5,000,000.01: 0.35%.";
  const unsupported = { ...rows[2], from: 5_000_000.01, rate_pct: 0.25, evidence: quote(upper) };
  const fees = summarize([{ ...standard, method: "marginal", methodEvidence: quote(marginal), tiers: [
    { ...rows[0], to: 1_000_000, evidence: quote(first) },
    { ...rows[1], from: 1_000_000.01, to: 5_000_000, rate_pct: 0.5, evidence: quote(bounded) },
    unsupported,
  ] }], [bounded, first, upper]);
  expect(fees.scenarios?.marginal).toMatchObject({ at1m: { dollars: 10_000 }, at5m: { dollars: 30_000 } });
  expect(fees.coverage.gaps).toContain("Unsupported tier rate or boundary");
});

it("retains posted prices and conditional floors as separate calculations", () => {
  const first = "First $3,000,000: 1.25%.";
  const second = "Above $3,000,000: 1%.";
  const minimum = "An annual minimum fee of $37,500 may apply and can be waived.";
  const fees = summarize([{ ...standard, method: "marginal", methodEvidence: quote(marginal), blocksExact: true,
    tiers: [
      { ...rows[0], to: 3_000_000, rate_pct: 1.25, evidence: quote(first) },
      { ...rows[2], from: 3_000_000, from_inclusive: false, rate_pct: 1, evidence: quote(second) },
    ],
    terms: [{ field: "minimum_annual_fee", amount: 37_500, value: "$37,500 if applied", condition: "conditional", evidence: quote(minimum) }],
  }], [first, second, minimum]);
  expect(fees.scenarios?.marginal).toMatchObject({
    at1m: { dollars: 12_500 }, at5m: { dollars: 57_500 },
    conditionalAnnualMinimums: [{ amount: 37_500, at1m: { dollars: 37_500 }, at5m: { dollars: 57_500 } }],
  });
  expect(fees.flags).toContain("conditional_minimum");
  expect(fees.at1m).toBeNull();
});

it("labels tiered ceilings and preserves the difference between a cap and no price", () => {
  const capped = summarize([{ ...standard, pricing: "cap", method: "marginal", methodEvidence: quote(marginal) }]);
  expect(capped).toMatchObject({ priceBasis: "ceiling", at1m: null, scenarios: { marginal: { at1m: { dollars: 10_000 } } } });
  const negotiated = summarize([{ ...standard, pricing: "negotiated", tiers: [] }]);
  expect(negotiated).toMatchObject({ classification: "no_price", at1m: null, at5m: null, priceBasis: null });
});

it("recognizes successive dollar bands and a whole-account fee clause, without inferring from a valuation date", () => {
  const first = "Up to $1,000,000 at 1%";
  const next = "Next $1,000,000 to $5,000,000 at 0.5%";
  const tiers = [
    { ...rows[0], from: 0, to: 1_000_000, rate_pct: 1, evidence: quote(first) },
    { ...rows[0], from: 1_000_000, to: 5_000_000, rate_pct: 0.5, evidence: quote(next) },
  ];
  expect(summarize([{ ...standard, tiers }], [first, next])).toMatchObject({
    method: "marginal", at5m: { dollars: 30_000 },
  });
  const band = "$1,000,001 to $5,000,000 at 0.5%";
  const ordinary = [{ ...standard, tiers: [tiers[0], { ...tiers[1], from: 1_000_001, evidence: quote(band) }] }];
  expect(summarize(ordinary, ["Account Balance Annual Fee", first, band, "The annual fee is calculated based upon the total value of your account."]))
    .toMatchObject({ method: "cliff", at5m: { dollars: 25_000 } });
  expect(summarize(ordinary, ["Account Balance Annual Fee", first, band, "We use the account value on the last business day."]))
    .toMatchObject({ method: null, flags: ["tier_method_unclear"] });
});

it.each([
  ["Adviser channel", "Standard fees for accounts offered through Financial Advisors and to institutional clients.", "adviser_channel"],
  ["Standard institutional", "Standard investment management for institutional clients.", "institutional"],
  ["Synthetic Equity Fund", "Standard fees for the named portfolio.", "fund"],
  ["Standard strategy", "The standard fee schedule by strategy.", "strategy"],
])("keeps %s pricing scoped even if the model labels it standard", (name, restricted, scopeType) => {
  const result = summarize([{ ...standard, name, scope: quote(restricted), method: "marginal", methodEvidence: quote(marginal) },
    { ...standard, method: "marginal", methodEvidence: quote(marginal) }], [restricted]);
  expect(result.primaryScheduleIndex).toBe(1);
  expect(result.schedules[0]).toMatchObject({ role: "scoped", scopeType });
});
