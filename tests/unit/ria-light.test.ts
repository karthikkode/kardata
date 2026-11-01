import { describe, expect, it } from "vitest";
import { brochureDate, splitBrochureItems } from "../../src/domain/ria-steps/brochure.js";
import { pickFirmWebsite, teamLinks, computeSignals, custodianNames, opsPrompt, OPS_SCHEMA, normalizeForGrounding } from "../../src/domain/ria-steps/handlers.js";


describe("pickFirmWebsite (B3)", () => {
  it("drops social URLs and lower-cases the firm's own site", () => {
    expect(pickFirmWebsite("https://www.linkedin.com/company/acme")).toBeNull();
    expect(pickFirmWebsite("HTTPS://ACME-Wealth.COM/about")).toBe("https://www.acme-wealth.com");
    expect(pickFirmWebsite(null)).toBeNull();
  });
});


describe("splitBrochureItems / brochureDate (B4)", () => {
  const text = [
    "Form ADV Part 2A 03/15/2025",
    "Item 4 Advisory Business",
    "We provide wealth management to individuals and families across the country with discretionary authority.",
    "Item 5 Fees and Compensation",
    "Our fee is tiered from 1.00% to 0.50% of assets under management and billed quarterly in advance with proration.",
    "Item 9 Disciplinary Information",
    "We have no disciplinary events to report at this time for the firm or its management persons.",
  ].join("\n");

  it("splits Items 4, 5 and 9", () => {
    const items = splitBrochureItems(text);
    expect(Object.keys(items).sort()).toEqual(["4", "5", "9"]);
    expect(items["5"]).toContain("tiered");
  });

  it("reads the brochure date", () => {
    expect(brochureDate(text)).toBe("2025-03-15");
    expect(brochureDate("no date here")).toBeNull();
  });
});


describe("ops schema and grounding normalisation", () => {
  it("schema requires ops fields and quotes", () => {
    const schema = JSON.parse(OPS_SCHEMA) as { required: string[] };
    expect(schema.required).toContain("custodians_named");
    expect(schema.required).toContain("quotes");
  });
  it("normalises ligatures, curly quotes and hyphenation", () => {
    expect(normalizeForGrounding("Fees are \u201cnegotia-\nble\u201d and \ufb01xed.")).toBe(normalizeForGrounding('fees are "negotiable" and fixed.'));
  });
  it("ops prompt stays under the 40K-token cap", () => {
    const prompt = opsPrompt([
      { item: "5", text: "x".repeat(60_000) },
      { item: "4", text: "y".repeat(50_000) },
      { item: "12", text: "z".repeat(50_000) },
    ]);
    expect(prompt.length).toBeLessThan(125_000);
  });
});

describe("opsPrompt (B5)", () => {
  it("carries the Item 5 text and the verbatim-quote rule", () => {
    const prompt = opsPrompt([{ item: "5", text: "Fees are tiered and negotiable." }]);
    expect(prompt).toContain("Fees are tiered and negotiable.");
    expect(prompt).toContain("Never invent a quote");
  });
});


describe("teamLinks (B6)", () => {
  it("finds team/about links only", () => {
    const html = `<a href="/team">Our Team</a><a href="/careers">Careers</a><a href="https://x.example/about-us">About</a>`;
    expect(teamLinks(html, "https://x.example/")).toEqual(["https://x.example/team", "https://x.example/about-us"]);
  });
});


describe("computeSignals (B7)", () => {
  const base = {
    familyGrouping: false,
    negotiable: false,
    feeTypeCount: 1,
    billing: "arrears",
    proration: false,
    refunds: false,
    custodianCount: 0,
    heavyBook: false,
    growthAumPct: null,
    growthStaffPct: null,
    growthStaffDelta: null,
    serviceCount: 0,
    outsideManagers: false,
    alternatives: false,
    custodyWork: false,
    disclosureFee: false,
    systemCount: 0,
  };

  it("fee_complexity needs at least three of the four fee traits", () => {
    expect(computeSignals({ ...base, negotiable: true }).fee_complexity).toBe(false);
    expect(computeSignals({ ...base, negotiable: true, familyGrouping: true }).fee_complexity).toBe(false);
    expect(computeSignals({ ...base, negotiable: true, billing: "advance", proration: true }).fee_complexity).toBe(false);
    expect(computeSignals({ ...base, negotiable: true, familyGrouping: true, billing: "advance", proration: true }).fee_complexity).toBe(true);
    expect(computeSignals({ ...base, billing: "advance", proration: true, feeTypeCount: 2 }).fee_complexity).toBe(false);
    expect(computeSignals({ ...base, billing: "advance", proration: true, feeTypeCount: 2, negotiable: true }).fee_complexity).toBe(true);
  });

  it("growth: AUM +30%+ or staff +20%+ with at least +2 people", () => {
    expect(computeSignals({ ...base, growthAumPct: 0.29 }).growth).toBe(false);
    expect(computeSignals({ ...base, growthAumPct: 0.3 }).growth).toBe(true);
    expect(computeSignals({ ...base, growthStaffPct: 0.25, growthStaffDelta: 1 }).growth).toBe(false);
    expect(computeSignals({ ...base, growthStaffPct: 0.25, growthStaffDelta: 2 }).growth).toBe(true);
  });

  it("ops signals and score", () => {
    const s = computeSignals({ ...base, custodianCount: 2, heavyBook: true, serviceCount: 3, outsideManagers: true, alternatives: true, custodyWork: true, disclosureFee: true, systemCount: 2 });
    expect(s).toMatchObject({ multi_custodian: true, heavy_book: true, many_services: true, outside_managers: true, alternatives: true, custody_work: true, fee_problem: true, tool_sprawl: true, recent_deal: false, ops_hiring: false });
    expect(s.score).toBe(8);
  });

  it("custodianNames reads the stored JSON custodian fact", () => {
    expect(custodianNames({ valueText: '["Fidelity", "Charles Schwab"]', valueJson: null }, [])).toEqual(["Fidelity", "Charles Schwab"]);
    expect(custodianNames({ valueText: null, valueJson: ["Fidelity", "Pershing"] }, [])).toEqual(["Fidelity", "Pershing"]);
    expect(custodianNames({ valueText: "Fidelity and Charles Schwab", valueJson: null }, [])).toEqual(["Fidelity", "Charles Schwab"]);
    expect(custodianNames(null, ["Fidelity"])).toEqual(["Fidelity"]);
  });
});

describe("parseBrochureChoice (B4)", () => {
  it("prefers the latest firm brochure over 2B and wrap-fee brochures", async () => {
    const { parseBrochureChoice } = await import("../../src/domain/ria-steps/handlers.js");
    const out = parseBrochureChoice({
      brochures: {
        part2ExemptFlag: "N",
        brochuredetails: [
          { brochureVersionID: 11, brochureName: "FIRM BROCHURE", dateSubmitted: "3/1/2025" },
          { brochureVersionID: 12, brochureName: "BROCHURE SUPPLEMENT 2B", dateSubmitted: "6/1/2026" },
          { brochureVersionID: 13, brochureName: "WRAP FEE PROGRAM BROCHURE", dateSubmitted: "7/1/2026" },
          { brochureVersionID: 14, brochureName: "FIRM BROCHURE", dateSubmitted: "4/1/2026" },
        ],
      },
    });
    expect(out).toEqual({ exempt: false, choice: { versionId: 14, name: "FIRM BROCHURE", dateSubmitted: "2026-04-01" } });
  });

  it("reports exempt and none-filed", async () => {
    const { parseBrochureChoice } = await import("../../src/domain/ria-steps/handlers.js");
    expect(parseBrochureChoice({ brochures: { part2ExemptFlag: "Y", brochuredetails: [] } })).toEqual({ exempt: true, choice: null });
    expect(parseBrochureChoice({ brochures: { part2ExemptFlag: "N", brochuredetails: [] } })).toEqual({ exempt: false, choice: null });
    expect(parseBrochureChoice(null)).toEqual({ exempt: false, choice: null });
  });
});

describe("splitBrochureItems heading styles (B4 gaps)", () => {
  const body = "This section holds real brochure text that is long enough to be stored as an Item document body.";

  it("reads Form ADV Part 2A, Item N headings", () => {
    const text = [
      "Form ADV Part 2A, Item 4 Advisory Business", body,
      "Form ADV Part 2A, Item 5 Fees and Compensation", body,
      "Form ADV, Part 2A, Item 9 Disciplinary Information", body,
    ].join("\n");
    expect(Object.keys(splitBrochureItems(text)).sort()).toEqual(["4", "5", "9"]);
  });

  it("reads Title - Item N headings", () => {
    const text = [
      "Advisory Business - Item 4", body,
      "Fees and Compensation - Item 5", body,
      "Custody - Item 15", body,
    ].join("\n");
    expect(Object.keys(splitBrochureItems(text)).sort()).toEqual(["15", "4", "5"]);
  });

  it("reads bare section titles, skipping the dotted TOC", () => {
    const text = [
      "Advisory Business ............ 4",
      "Fees and Compensation ............ 5",
      "Disciplinary Information ............ 9",
      "Advisory Business", body,
      "Fees and Compensation", body,
      "Disciplinary Information", body,
    ].join("\n");
    const items = splitBrochureItems(text);
    expect(Object.keys(items).sort()).toEqual(["4", "5", "9"]);
    expect(items["5"]).toContain("real brochure text");
  });

  it("still gaps a scan with no headings", () => {
    expect(splitBrochureItems("Some scanned page image text without any structure at all.")).toEqual({});
  });
});

describe("splitBrochureItems table of contents (B4)", () => {
  it("slices body sections, not the TOC", () => {
    const body = "This section holds real brochure text that is long enough to be stored as an Item document body.";
    const text = [
      "Item 4: Advisory Business ............ 4",
      "Item 5: Fees and Compensation ............ 6",
      "Item 9: Disciplinary Information ............ 9",
      "Item 4 Advisory Business", body,
      "Item 5 Fees and Compensation", body,
      "Item 9 Disciplinary Information", body,
    ].join("\n");
    const items = splitBrochureItems(text);
    expect(Object.keys(items).sort()).toEqual(["4", "5", "9"]);
    expect(items["5"]).toContain("real brochure text");
    expect(items["5"]).not.toContain("............");
  });
});

describe("pickScheduleAContact", () => {
  it("prefers COO/head of operations, then CCO, then CEO/president", async () => {
    const { pickScheduleAContact } = await import("../../src/domain/ria-steps/handlers.js");
    const leaders = [
      { name: "A Boss", title: "Chief Executive Officer" },
      { name: "B Compliance", title: "Chief Compliance Officer" },
      { name: "C Ops", title: "Head of Operations" },
    ];
    expect(pickScheduleAContact(leaders)?.name).toBe("C Ops");
    expect(pickScheduleAContact(leaders.slice(0, 2))?.name).toBe("B Compliance");
    expect(pickScheduleAContact(leaders.slice(0, 1))?.name).toBe("A Boss");
    expect(pickScheduleAContact([{ name: "E Dual", title: "Chief Operating Financial Officer" }])?.name).toBe("E Dual");
    expect(pickScheduleAContact([{ name: "D Adviser", title: "Financial Advisor" }])).toBeNull();
  });
});
