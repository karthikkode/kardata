import { describe, expect, it } from "vitest";
import { DEFAULT_RIA_THRESHOLDS } from "../../src/domain/sector-preflight/profile.js";
import { evaluateRia, type RiaFacts } from "../../src/domain/sector-preflight/ria.js";

const base: RiaFacts = {
  aum: 200_000_000,
  employees: 10,
  wealthShare: 0.9,
  firmType: "Registered",
  registrationStatus: "Approved",
  country: "United States",
  state: "TX",
};

describe("evaluateRia", () => {
  it.each([
    [{ employees: 0 }, "Reject", null, "no_staff"],
    [{ employees: 1 }, "Accept", 0, null],
    [{ employees: 1, aum: 500_000_000 }, "Accept", 0, null],
    [{ employees: 2 }, "Accept", 1, null],
    [{ employees: 10, aum: 500_000_000 }, "Accept", 2, null],
    [{ employees: 10, aum: 499_999_999 }, "Accept", 1, null],
    [{ employees: 9, aum: 500_000_000 }, "Accept", 1, null],
    [{ employees: 100, aum: 10_000_000_000 }, "Accept", 2, null],
    [{ aum: 10_000_000_001 }, "Reject", null, "large"],
    [{ employees: 101 }, "Reject", null, "large"],
    [{ wealthShare: 0.49 }, "Hold", null, "hold_not_wealth"],
    [{ wealthShare: null }, "Hold", null, "hold_not_wealth"],
    [{ wealthShare: 0.5 }, "Accept", 1, null],
    [{ country: "Canada" }, "Reject", null, "not_us"],
    [{ firmType: "Exempt Reporting" }, "Reject", null, "not_active"],
    [{ registrationStatus: "Terminated" }, "Reject", null, "not_active"],
    [{ registrationStatus: null }, "Reject", null, "not_active"],
    [{ inNewestFile: false }, "Reject", null, "not_active"],
    [{ country: null, state: "TX" }, "Accept", 1, null],
    [{ country: null, state: "ON" }, "Reject", null, "not_us"],
    [{ employees: 0, wealthShare: null }, "Reject", null, "no_staff"],
    [{ country: "Canada", aum: 11_000_000_000 }, "Reject", null, "not_us"],
    [{ inNewestFile: false, country: "Canada", employees: 0 }, "Reject", null, "not_active"],
  ])("applies ordered rules to %j", (patch, decision, tier, reason) => {
    expect(evaluateRia({ ...base, ...patch }, DEFAULT_RIA_THRESHOLDS)).toMatchObject({ decision, tier, reason, eligible: decision === "Accept" });
  });
});
