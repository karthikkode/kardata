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
};

describe("evaluateRia", () => {
  it("splits P under $500M and R at or over it", () => {
    expect(evaluateRia(base, DEFAULT_RIA_THRESHOLDS).group).toBe("P");
    expect(evaluateRia({ ...base, aum: 500_000_000 }, DEFAULT_RIA_THRESHOLDS).group).toBe("R");
    expect(evaluateRia({ ...base, aum: 10_000_000_000 }, DEFAULT_RIA_THRESHOLDS).eligible).toBe(true);
  });

  it("keeps aside each ineligible reason", () => {
    expect(evaluateRia({ ...base, aum: 10_000_000_001 }, DEFAULT_RIA_THRESHOLDS).reason).toBe("large");
    expect(evaluateRia({ ...base, employees: 101 }, DEFAULT_RIA_THRESHOLDS).reason).toBe("large");
    expect(evaluateRia({ ...base, wealthShare: 0.49 }, DEFAULT_RIA_THRESHOLDS).reason).toBe("not_wealth");
    expect(evaluateRia({ ...base, wealthShare: 0.5 }, DEFAULT_RIA_THRESHOLDS).eligible).toBe(true);
    expect(evaluateRia({ ...base, employees: 1 }, DEFAULT_RIA_THRESHOLDS).reason).toBe("no_staff");
    expect(evaluateRia({ ...base, employees: 2 }, DEFAULT_RIA_THRESHOLDS).eligible).toBe(true);
    expect(evaluateRia({ ...base, firmType: "Exempt Reporting" }, DEFAULT_RIA_THRESHOLDS).reason).toBe("exempt_or_inactive");
    expect(evaluateRia({ ...base, registrationStatus: "Terminated" }, DEFAULT_RIA_THRESHOLDS).reason).toBe("exempt_or_inactive");
    expect(evaluateRia({ ...base, country: "Canada" }, DEFAULT_RIA_THRESHOLDS).reason).toBe("not_us");
  });
});
