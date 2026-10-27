import { describe, expect, it } from "vitest";
import type { CompanyIcpCheck } from "../../src/db/schema.js";
import {
  ALL_HEADER,
  OUTREACH_HEADER,
  TRACKING_COLUMNS,
  allCheckedCsv,
  buyerOrder,
  observations,
  outreachCsv,
  type OutreachRow,
} from "../../src/domain/icp/sheet.js";

function row(patch: Partial<OutreachRow>): OutreachRow {
  return {
    companyId: "00000000-0000-4000-8000-00000000000a",
    tier: "B",
    layer: 4,
    score: 3,
    company: "Synthetic Seed Co",
    domain: "seed.example",
    country: "United Kingdom",
    revenueUsed: 3_500_000,
    revenueSource: "apollo",
    flags: "",
    staff: 20,
    signalsMet: ["Sells across channels", "Tool sprawl"],
    observations: ['Sells across channels (2026-10-01): Stocked by "Garden Mart", and more. https://seed.example/stockists'],
    techTeam: false,
    buyerOrder: buyerOrder(20),
    ...patch,
  };
}

function check(): CompanyIcpCheck {
  return {
    id: "c",
    companyId: "x",
    sectorId: "s",
    runId: null,
    promptVersion: "icp-v1",
    packHash: "h",
    score: 2,
    status: "contactable",
    exclusionReason: null,
    results: {
      signals: [
        { key: "channels", verdict: "yes", counted: true, refs: ["r:1"], droppedRefs: [], observation: "Stocked by Garden Mart.", note: null },
        { key: "hiring", verdict: "yes", counted: false, refs: [], droppedRefs: ["r:9"], observation: "Hiring ops.", note: "x" },
        { key: "tool_sprawl", verdict: "yes", counted: true, refs: ["f:2"], droppedRefs: [], observation: "Klaviyo and Omnisend both run email.", note: null },
      ],
    },
    evidence: [
      { ref: "r:1", kind: "record", key: "retailer", value: "Garden Mart", quote: null, url: "https://seed.example/stockists", date: "2026-10-01", dateKind: "stated", origin: "grounded" },
      { ref: "f:2", kind: "fact", key: "marketing.tool", value: "Klaviyo", quote: null, url: null, date: "2026-10-20", dateKind: "seen", origin: "grounded" },
    ],
    usage: null,
    createdAt: new Date("2026-10-27T00:00:00Z"),
  };
}

describe("outreach sheet", () => {
  it("writes one block per tier with the header, quoting and blank tracking columns", () => {
    const csv = outreachCsv([row({}), row({ tier: "C", layer: 5, score: 2, company: "Small, Co" })]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Tier B");
    expect(lines[1]).toBe(OUTREACH_HEADER.join(","));
    expect(OUTREACH_HEADER.slice(-TRACKING_COLUMNS.length)).toEqual(TRACKING_COLUMNS);
    expect(lines[2]).toContain('"Sells across channels (2026-10-01): Stocked by ""Garden Mart"", and more. https://seed.example/stockists"');
    expect(lines[2]?.endsWith(",".repeat(TRACKING_COLUMNS.length))).toBe(true);
    expect(lines[3]).toBe("Tier C");
    expect(lines[5]).toContain('"Small, Co"');
  });

  it("orders buyers by staff size, roles only", () => {
    expect(buyerOrder(20)).toMatch(/^Founder\/CEO/);
    expect(buyerOrder(120)).toMatch(/^COO/);
    expect(buyerOrder(null)).toMatch(/^COO/);
  });

  it("lists only counted signals as observations, with date and url", () => {
    expect(observations(check())).toEqual([
      "Sells across channels (2026-10-01): Stocked by Garden Mart. https://seed.example/stockists",
      "Tool sprawl (2026-10-20): Klaviyo and Omnisend both run email.",
    ]);
  });

  it("writes every checked company with its status and reason", () => {
    const csv = allCheckedCsv([
      {
        companyId: "id1", name: "Out Co", domain: "out.example", country: "Canada", checkedAt: "2026-10-27T10:00:00.000Z",
        score: 3, status: "excluded", tier: "A", layer: 4, exclusionReason: "Has a data team: Head of Data", signalsMet: ["Tool sprawl"],
        techTeam: false, revenueUsed: 1, revenueSource: "apollo",
      },
    ]);
    const [header, line] = csv.trim().split("\n");
    expect(header).toBe(ALL_HEADER.join(","));
    expect(line).toBe("Out Co,out.example,Canada,id1,excluded,A,4,3,Has a data team: Head of Data,Tool sprawl,2026-10-27");
  });
});
