import { describe, expect, it } from "vitest";
import { RIA_COLLECT_ADAPTERS, RIA_COLLECT_AREAS, riaPreflightReport } from "../../src/domain/company-jobs/preflight.js";
import { resolvePlanAdapters } from "../../src/collect/adapters.js";

describe("fixed RIA collect plan (follow-up)", () => {
  it("uses sec_firm, site, jobs, news and the six RIA areas, no LLM fields", () => {
    const report = riaPreflightReport();
    expect(report.adaptersRequired.map((a) => a.adapterId)).toEqual([...RIA_COLLECT_ADAPTERS]);
    expect(RIA_COLLECT_ADAPTERS).toEqual(["sec_firm", "site", "jobs", "news"]);
    expect(report.collectDirectives.areas).toEqual([...RIA_COLLECT_AREAS]);
    expect(resolvePlanAdapters([...RIA_COLLECT_ADAPTERS]).unknown).toEqual([]);
    expect(report.confidence).toBe(1);
  });
});
