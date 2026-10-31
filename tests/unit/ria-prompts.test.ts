import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";
import { assembleAreaPrompt } from "../../src/runs/extract.js";
import { buildResearchPrompt, RIA_AREAS, researchVersionForPlaybook } from "../../src/runs/prompt.js";

function riaProfile() {
  return parseSectorProfile(JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown);
}

describe("RIA prompts (Stage 5.7 B5)", () => {
  it("chooses ria-v1 by playbook and renders all six briefs without a plausibility section", () => {
    expect(researchVersionForPlaybook("ria")).toBe("ria-v1");
    expect(researchVersionForPlaybook("d2c")).not.toBe("ria-v1");
    expect(RIA_AREAS).toEqual(["firm_and_fees", "people_and_ops", "systems", "deals_and_growth", "hiring", "compliance"]);
    const company = {
      id: "00000000-0000-0000-0000-000000000001",
      apolloAccountId: null,
      secCrd: "777001",
      source: "sec",
      domain: "fake.example",
      sharedDomain: false,
      name: "Fake Adviser LLC",
      website: "https://fake.example",
      linkedinUrl: null,
      facebookUrl: null,
      twitterUrl: null,
      employees: 10,
      industry: null,
      keywords: [],
      technologies: [],
      country: "United States",
      state: "TX",
      city: "Austin",
      postalCode: null,
      address: null,
      phone: null,
      annualRevenue: null,
      totalFunding: null,
      latestFunding: null,
      latestFundingAmount: null,
      lastRaisedAt: null,
      foundedYear: null,
      shortDescription: null,
      logoUrl: null,
      sicCodes: [],
      naicsCodes: [],
      raw: {},
      overrides: {},
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never;
    const run = { id: "00000000-0000-0000-0000-000000000002", promptVersion: "ria-v1", stage: "research" } as never;
    const prompt = buildResearchPrompt({ run, company, brief: undefined, sectorProfile: riaProfile() });
    for (const area of RIA_AREAS) expect(prompt).toContain(area);
    expect(prompt).toContain("fee schedule");
    expect(prompt).not.toContain("Revenue plausibility");
    expect(prompt).toContain("Stored evidence first");
  });

  it("renders the ria extraction template for a DB area", () => {
    const prompt = assembleAreaPrompt(
      "financials",
      { keys: "(none)", types: "(none)" },
      { notes: "notes", sourceIds: [] },
      "ria",
    );
    expect(prompt).toContain("Extraction: firm_and_fees");
  });
});
