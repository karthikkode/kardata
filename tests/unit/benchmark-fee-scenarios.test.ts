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
  expect(tied.primaryScheduleIndex).toBe(0);
  expect(tied.schedules.map(schedule => schedule.role)).toEqual(["primary", "alternative"]);
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

function band(from: number, to: number | null, rate_pct: number, text: string) {
  return { from, to, rate_pct, from_inclusive: from === 0, to_inclusive: true, evidence: quote(text) };
}

it("chooses wealth management among standard offerings and retains the other standard schedule", () => {
  const investment = "Standard investment management";
  const wealth = "Standard wealth management";
  const first = "First $500,000: 1.25%.";
  const excess = "Plus on assets over $500,000: 1%.";
  const wealthRows = ["First $2,000,000: 1%.", "Next $2,000,000: 0.85%.", "Next $2,000,000: 0.65%."];
  const minimum = "The annual wealth management fee is at least $12,500.";
  const result = summarize([
    { ...standard, name: investment, scope: quote(investment), tiers: [
      band(0, 500_000, 1.25, first), band(500_000, null, 1, excess),
    ] },
    { ...standard, name: wealth, scope: quote(wealth), tiers: [
      band(0, 2_000_000, 1, wealthRows[0]!), band(2_000_000, 4_000_000, 0.85, wealthRows[1]!),
      band(4_000_000, 6_000_000, 0.65, wealthRows[2]!),
    ], terms: [{ field: "minimum_annual_fee", amount: 12_500, value: "Annual minimum", condition: "applies", evidence: quote(minimum) }] },
  ], [investment, wealth, first, excess, ...wealthRows, minimum]);
  expect(result).toMatchObject({ primaryScheduleIndex: 1, at1m: { dollars: 12_500 }, at5m: { dollars: 43_500 } });
  expect(result.schedules[0]).toMatchObject({ role: "alternative", scopeType: "standard", method: "marginal",
    at1m: { dollars: 11_250 }, at5m: { dollars: 51_250 } });
});

it("uses brochure order for distinct standard offerings without wealth management", () => {
  const earlier = "Standard investment advisory";
  const later = "Standard financial advisory";
  const result = summarize([
    { ...standard, scope: quote(later) }, { ...standard, scope: quote(earlier) },
  ], [earlier, later]);
  expect(result.primaryScheduleIndex).toBe(1);
  expect(result.schedules[0]?.role).toBe("alternative");
});

it("prices balances inside the first grounded marginal band even when later rows cannot be grounded", () => {
  const first = "1% on the first $5 million, plus";
  const next = "¾ of 1% on the next $5 million, plus";
  const last = "½ of 1% on the balance.";
  const prefix = [band(0, 5_000_000, 1, first)];
  for (const upper of [
    [],
    [band(5_000_000, 10_000_000, 0.75, next), band(10_000_000, null, 0.5, last)],
    [band(5_000_000, 10_000_000, 0.7, next), band(10_000_000, null, 0.4, last)],
    [band(5_000_000, 10_000_000, 0.7, "Missing quote"), band(10_000_000, null, 0.4, "Also missing")],
  ]) {
    const result = summarize([{ ...standard, method: "marginal", methodEvidence: quote(first), tiers: [...prefix, ...upper] }],
      [first, next, last]);
    expect(result).toMatchObject({ method: "marginal", at1m: { dollars: 10_000 }, at5m: { dollars: 50_000 } });
    if (upper[0]?.rate_pct === 0.75) expect(result.schedules[0]?.tiers).toHaveLength(3);
  }
});

it("uses a covered balance when an ungrounded later band starts above the prefix", () => {
  const first = "Up to $5 million: 1%.";
  const result = summarize([{ ...standard, method: "marginal", methodEvidence: quote(marginal),
    tiers: [band(0, 5_000_000, 1, first), band(10_000_000, null, 0.5, "Missing later row")],
  }], [first]);
  expect(result).toMatchObject({ at1m: { dollars: 10_000 }, at5m: { dollars: 50_000 } });
});

it("uses a minimum-account bracket as first-band eligibility and grounds Plus on assets over", () => {
  const first = "On assets $300,000 through $1 million: 1.10%.";
  const second = "Plus, on assets over $1 million through $2 million: 0.85%.";
  const third = "Plus on assets over $2 million through $3 million: 0.75%.";
  const fourth = "Plus on assets over $3 million through $6 million: 0.65%.";
  const below = "For accounts less than $300,000, the fee will be between 1.25 and 1.75 percent.";
  const result = summarize([
    { ...standard, tiers: [
      { ...band(300_000, 1_000_000, 1.1, first), from_inclusive: true },
      { ...band(1_000_000, 2_000_000, 0.85, second), from_inclusive: true },
      band(2_000_000, 3_000_000, 0.75, third),
      band(3_000_000, 6_000_000, 0.65, fourth),
    ] },
    { ...standard, pricing: "range", scope: quote(below), tiers: [],
      rateBounds: { lower_pct: 1.25, upper_pct: 1.75, evidence: quote(below) } },
  ], [first, second, third, fourth, below]);
  expect(result).toMatchObject({ method: "marginal", minimumAccountSize: 300_000,
    at1m: { dollars: 11_000 }, at5m: { dollars: 40_000 } });
  expect(result.schedules).toHaveLength(1);
  expect(result.schedules[0]?.brackets[0]).toMatchObject({ pricing: "range", rateBounds: { lower_pct: 1.25, upper_pct: 1.75 } });
});

it("keeps the negotiated account bracket and marks the overlapping whole-account scenario conditional", () => {
  const first = "Generally, clients pay 1% on assets up to $1 million.";
  const higher = "Accounts holding $1 million or more receive a lower fee at a negotiated level.";
  const calculation = "Fees are calculated by multiplying the assets under management market value (as reported by the account custodian) by the relevant percent.";
  const result = summarize([
    { ...standard, tiers: [{ ...band(0, 1_000_000, 1, first), to_inclusive: false }] },
    { ...standard, pricing: "negotiated", scope: quote(higher), tiers: [], blocksExact: true },
  ], [first, higher, calculation]);
  expect(result.schedules).toHaveLength(1);
  expect(result.schedules[0]).toMatchObject({ role: "primary", method: "cliff", brackets: [{ pricing: "negotiated" }],
    scenarios: { marginal: null, cliff: { at1m: { dollars: 10_000, conditional: true }, at5m: null } },
  });
  expect(result).toMatchObject({ at1m: null, at5m: null, method: null, flags: ["conditional_account_bracket"] });
});

it.each([
  ["Synthetic Advisory Wrap Fee Program", "The adviser offers a wrap fee program."],
  ["Asset management", "ASSET MANAGEMENT AS A WRAP PROGRAM"],
])("labels %s as wrap from the firm brochure", (name, label) => {
  const result = summarize([{ ...standard, name, category: "program", scope: quote(label) }], [label]);
  expect(result.schedules[0]).toMatchObject({ role: "scoped", scopeType: "wrap" });
});

it("prefers a published table to an earlier wealth-management cap", () => {
  const cap = "The maximum fee for wealth management is 2%.";
  const result = summarize([
    { ...standard, name: "Wealth Management", scope: quote(cap), pricing: "cap", tiers: [],
      rateBounds: { lower_pct: null, upper_pct: 2, evidence: quote(cap) } },
    standard,
  ], [cap]);
  expect(result).toMatchObject({ primaryScheduleIndex: 1, scenarios: {
    cliff: { at1m: { dollars: 9_000 } }, marginal: { at1m: { dollars: 10_000 } },
  } });
  expect(result.schedules[0]?.role).toBe("alternative");
});

it("scopes product-specific fees even when the model calls them standard and the restriction starts on the next page", () => {
  const title = "Our annual advisory fee is 1% of AUM for Long-Term Advisory Services.";
  const continuation = "AUM is determined on the";
  const basis = "AUM is based on the aggregate Net Asset Value (“NAV”) of Client's Specialty Investments acquired during the term.";
  const section = { kind: "firm" as const, sourceId: "source", documentId: "doc", date: "2026-03-31" };
  const review = groundFeeReview({ schedules: [
    { ...standard, scope: quote(title), tiers: [band(0, null, 1, title)] },
  ], terms: [], findings: [], inspect: [], gaps: [] }, [
    { ...section, ref: "item-5", page: 5, text: `${title} ${continuation}` },
    { ...section, ref: "p6", page: 6, text: `last business day of the month. ${basis}` },
  ]);
  const result = summarizeFeeReview(review, [], { complete: true, gaps: [] });
  expect(result.primaryScheduleIndex).toBeNull();
  expect(result.schedules[0]).toMatchObject({ role: "scoped", scopeType: "product",
    productBasis: { ref: "p6", page: 6 }, at1m: { dollars: 10_000 } });
});

it("keeps explicitly limited strategies and model portfolios out of standard alternatives", () => {
  const limited = "The strategy fee applies only to municipal securities.";
  const model = "Advisory services through the model portfolio.";
  const result = summarize([
    { ...standard, scope: quote(limited) },
    { ...standard, name: "Managed Model Portfolio Service", scope: quote(model) },
    standard,
  ], [limited, model]);
  expect(result.primaryScheduleIndex).toBe(2);
  expect(result.schedules.slice(0, 2)).toMatchObject([
    { role: "scoped", scopeType: "product" }, { role: "scoped", scopeType: "product" },
  ]);
});

it.each([0.1, 3.01])("scopes a %s percent standard rate and selects the next eligible table", rate => {
  const flat = `Standard management fee: ${rate}%.`;
  const result = summarize([
    { ...standard, name: "Wealth Management", scope: quote(flat), tiers: [band(0, null, rate, flat)] },
    standard,
  ], [flat]);
  expect(result.primaryScheduleIndex).toBe(1);
  expect(result.schedules[0]).toMatchObject({ role: "scoped", flags: ["rate_review"], at1m: { dollars: Math.round(rate * 10_000) } });
});

it.each([0.25, 3])("accepts the inclusive %s percent review boundary", rate => {
  const flat = `Standard management fee: ${rate}%.`;
  const result = summarize([{ ...standard, scope: quote(flat), tiers: [band(0, null, rate, flat)] }], [flat]);
  expect(result).toMatchObject({ primaryScheduleIndex: 0, at1m: { dollars: Math.round(rate * 10_000) } });
  expect(result.schedules[0]?.flags).not.toContain("rate_review");
});

it("withholds only the whole-account reading at a printed shared boundary", () => {
  const captions = ["Up to $999,999: 1%.", "$1million - $3 million: 0.90%.",
    "$3 million – $5 million: 0.80%.", "$5 million - $7 million: 0.70%."];
  const result = summarize([{ ...standard, pricing: "cap", tiers: [
    band(0, 999_999, 1, captions[0]!), { ...band(1_000_000, 3_000_000, 0.9, captions[1]!), from_inclusive: true },
    band(3_000_000, 5_000_000, 0.8, captions[2]!), band(5_000_000, 7_000_000, 0.7, captions[3]!),
  ] }], captions);
  expect(result.scenarios).toMatchObject({
    cliff: { at1m: { dollars: 9_000 }, at5m: null },
    marginal: { at1m: { dollars: 10_000 }, at5m: { dollars: 44_000 } },
  });
});

it("allows comparable fees at or above a rejected account minimum without publishing it as verified", () => {
  const flat = "The annual advisory fee is 1%.";
  const minimum = { field: "minimum_account_size", value: "Suggested account minimum", amount: 1_000_000,
    condition: "applies", evidence: quote("An account minimum of $1,000,000 is required.") };
  const result = summarize([{ ...standard, tiers: [band(0, null, 1, flat)], terms: [minimum] }], [flat]);
  expect(result).toMatchObject({ at1m: { dollars: 10_000 }, at5m: { dollars: 50_000 }, minimumAccountSize: null,
    flags: ["minimum_account_review"] });
  expect(result.coverage.gaps).toContain("Unsupported term: minimum_account_size");
  expect(summarize([{ ...standard, tiers: [band(0, null, 1, flat)], terms: [{ ...minimum, amount: 2_000_000 }] }], [flat]))
    .toMatchObject({ at1m: null, at5m: { dollars: 50_000 } });
});

it("keeps subscriptions, planning retainers, and unpriced descriptions outside primary fees", () => {
  const subscription = "Full platform access costs $40 per month.";
  const retainer = "Comprehensive financial planning retainer starts at 0.70% of investable assets.";
  const unpriced = "Fees vary based on the size of the managed account.";
  const result = summarize([
    { ...standard, scope: quote(subscription), pricing: "subscription", tiers: [] },
    { ...standard, scope: quote(retainer), pricing: "range", tiers: [] },
    { ...standard, scope: quote(unpriced), pricing: "other", tiers: [] },
  ], [subscription, retainer, unpriced]);
  expect(result.primaryScheduleIndex).toBeNull();
  expect(result.schedules.map(s => s.role)).toEqual(["scoped", "scoped", "scoped"]);
});

it.each([
  ["Wrap Comprehensive Portfolio Management", "We bill for Wrap Comprehensive Portfolio Management quarterly."],
  ["Managed account services and other wrap programs", "Managed account fees"],
  ["Sponsor bundled fee", "Clients in a Wrap Account are charged a bundled fee by the sponsor."],
])("keeps the %s wrap disclosure scoped even when no rate is published", (name, label) => {
  const result = summarize([{ ...standard, name, category: "program", pricing: "other", scope: quote(label), tiers: [] }], [label]);
  expect(result.schedules[0]).toMatchObject({ role: "scoped", scopeType: "wrap" });
});

it.each(["to", "through"])("leaves the cliff fee unresolved at $5M shared by '%s' ranges", connector => {
  const method = "One rate applies to the whole account value.";
  const first = `$0 ${connector} $5 million: 1%.`;
  const second = `$5 million ${connector} $10 million: 0.8%.`;
  const result = summarize([{ ...standard, method: "cliff", methodEvidence: quote(method),
    tiers: [band(0, 5_000_000, 1, first), band(5_000_000, 10_000_000, 0.8, second)],
  }], [method, first, second]);
  expect(result).toMatchObject({ at1m: { dollars: 10_000 }, at5m: null,
    scenarios: { cliff: { at5m: null }, marginal: null } });
});

it.each(["over $5 million through $10 million", "$5 million (exclusive) to $10 million"])(
  "respects the explicit exclusion in '%s'", range => {
    const method = "One rate applies to the whole account value.";
    const first = "$0 to $5 million: 1%.";
    const second = `${range}: 0.8%.`;
    const result = summarize([{ ...standard, method: "cliff", methodEvidence: quote(method),
      tiers: [band(0, 5_000_000, 1, first), band(5_000_000, 10_000_000, 0.8, second)],
    }], [method, first, second]);
    expect(result.at5m?.dollars).toBe(50_000);
  },
);

it("keeps explicit marginal pricing comparable at $1M and $5M shared by dash bands", () => {
  const ranges = ["$0 - $1 million: 1%.", "$1 million - $5 million: 0.8%.", "$5 million - $10 million: 0.5%."];
  const result = summarize([{ ...standard, method: "marginal", methodEvidence: quote(marginal), tiers: [
    band(0, 1_000_000, 1, ranges[0]!), band(1_000_000, 5_000_000, 0.8, ranges[1]!),
    band(5_000_000, 10_000_000, 0.5, ranges[2]!),
  ] }], ranges);
  expect(result).toMatchObject({ classification: "comparable", at1m: { dollars: 10_000 }, at5m: { dollars: 42_000 } });
});

it.each([[1, true], [0.1, false], [3.01, false]] as const)("checks the %s percent rate before a $40,000 floor", (rate, eligible) => {
  const flat = `Standard management fee: ${rate}%.`;
  const minimum = "The minimum annual fee is $40,000.";
  const result = summarize([{ ...standard, scope: quote(flat), tiers: [band(0, null, rate, flat)], terms: [
    { field: "minimum_annual_fee", value: "Annual minimum", amount: 40_000, condition: "applies", evidence: quote(minimum) },
  ] }], [flat, minimum]);
  expect(result.schedules[0]).toMatchObject({ role: eligible ? "primary" : "scoped", at1m: { dollars: 40_000 } });
  expect(result.schedules[0]?.flags.includes("rate_review")).toBe(!eligible);
  expect(result.at1m?.dollars).toBe(eligible ? 40_000 : undefined);
});
