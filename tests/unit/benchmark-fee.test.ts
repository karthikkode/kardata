import { expect, it } from "vitest";
import { feePilotSummary } from "../../src/domain/benchmark/fees.js";
import { effectiveFee } from "../../src/domain/benchmark/fee-math.js";
import { groundFeeExtraction } from "../../src/domain/benchmark/fee-extraction.js";

const tiers = [{ from: 0, to: 1_000_000, rate_pct: 1 }, { from: 1_000_000, to: null, rate_pct: 0.5 }];
const blankTerms = { types: null, tier_method: null, tiers: [], minimum_annual_fee: null, minimum_account_size: null,
  billing_cadence: null, billing_timing: null, value_basis: null, negotiable: null, household_grouping: null,
  proration: null, termination_refund: null };

it("computes marginal and cliff fees, exact boundaries, open tiers, and minimums", () => {
  expect(effectiveFee({ tiers, method: "marginal", balance: 5_000_000 })).toEqual({ dollars: 30_000, rate_pct: 0.6 });
  expect(effectiveFee({ tiers, method: "cliff", balance: 5_000_000 })).toEqual({ dollars: 25_000, rate_pct: 0.5 });
  expect(effectiveFee({ tiers, method: "cliff", balance: 1_000_000 })).toEqual({ dollars: 10_000, rate_pct: 1 });
  expect(effectiveFee({ tiers, method: "marginal", balance: 1_000_000, minimumAnnualFee: 15_000 })?.dollars).toBe(15_000);
  expect(effectiveFee({ tiers, method: "cliff", balance: 1_000_000, minimumAccountSize: 2_000_000 })).toBeNull();
  expect(effectiveFee({ tiers: [{ from: 0, to: null, rate_pct: 0.5 }], method: "cliff", balance: 1_000_000 })?.dollars).toBe(5_000);
  expect(effectiveFee({ tiers: [tiers[0]!, { ...tiers[1]!, from: 2_000_000 }], method: "marginal", balance: 1_000_000 })).toBeNull();
});

it("retains unstated terms and requires grounded quotes and rates", () => {
  const text = "Our annual fee is 1% of managed assets. The annual minimum fee is $12,000.";
  const raw = { ...blankTerms, minimum_annual_fee: { value: 12_000, quote: "The annual minimum fee is $12,000." },
    tiers: [{ from: 0, to: null, rate_pct: 1, quote: "Our annual fee is 1% of managed assets." }] };
  const extraction = groundFeeExtraction(raw, text);
  expect(extraction.terms.negotiable).toBeNull();
  expect(extraction.at1m).toEqual({ dollars: 12_000, rate_pct: 1.2 });
  expect(extraction.at5m).toEqual({ dollars: 50_000, rate_pct: 1 });
  expect(() => groundFeeExtraction({ ...raw, billing_timing: { value: "arrears", quote: "Billed in arrears." } }, text)).toThrow(/quote/);
  expect(() => groundFeeExtraction({ ...raw, tiers: [{ ...raw.tiers[0], rate_pct: 1.5 }] }, text)).toThrow(/grounded rate/);
  expect(groundFeeExtraction(blankTerms, text).at1m).toBeNull();
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
