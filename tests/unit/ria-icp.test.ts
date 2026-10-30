import { describe, expect, it } from "vitest";
import type { EvidencePack } from "../../src/domain/icp/evidence.js";
import { decideRia, icpSchema, parseJudgement } from "../../src/domain/icp/judge.js";
import { pickContact, timeZoneForState } from "../../src/domain/icp/sheet.js";

function pack(riaExclusion: string | null = null): EvidencePack {
  const item = (ref: string) => ({
    ref,
    title: ref,
    url: null,
    date: "2026-01-01",
    quote: "quoted text",
    origin: "stored" as const,
    note: "",
  });
  return {
    buckets: {
      fee_complexity: [item("f:1")],
      recent_deal: [],
      ops_hiring: [item("r:1")],
      multi_custodian: [],
      growth: [],
      tool_sprawl: [],
      fee_problem: [],
    },
    usable: 2,
    dropped: [],
    companyId: "c1",
    sectorId: "s1",
    company: { name: "Fake LLC", domain: "fake.example", country: "United States", employees: 10 },
    preflight: null,
    revenue: { revenueUsed: null, revenueSource: null, tier: null, flags: [] },
    playbook: "ria",
    riaExclusion,
  } as EvidencePack;
}

function judgement() {
  return parseJudgement(
    {
      signals: {
        fee_complexity: { verdict: "yes", evidence_refs: ["f:1"], observation: "Tiered fees with family grouping." },
        recent_deal: { verdict: "unknown", evidence_refs: [], observation: "" },
        ops_hiring: { verdict: "yes", evidence_refs: ["r:1"], observation: "Billing coordinator post, Jan 2026." },
        multi_custodian: { verdict: "unknown", evidence_refs: [], observation: "" },
        growth: { verdict: "unknown", evidence_refs: [], observation: "" },
        tool_sprawl: { verdict: "unknown", evidence_refs: [], observation: "" },
        fee_problem: { verdict: "unknown", evidence_refs: [], observation: "" },
      },
      exclusions: {},
      flags: {},
    },
    "ria",
  );
}

describe("RIA ICP (Stage 5.7 B6)", () => {
  it("scores signals and accepts score 0 firms", () => {
    const decision = decideRia(pack(), judgement());
    expect(decision.score).toBe(2);
    expect(decision.status).toBe("icp_accepted");
    const empty = parseJudgement(
      {
        signals: Object.fromEntries(
          ["fee_complexity", "recent_deal", "ops_hiring", "multi_custodian", "growth", "tool_sprawl", "fee_problem"].map((k) => [
            k,
            { verdict: "unknown", evidence_refs: [], observation: "" },
          ]),
        ),
        exclusions: {},
        flags: {},
      },
      "ria",
    );
    expect(decideRia(pack(), empty).status).toBe("icp_accepted");
  });

  it("rejects from the preflight reason", () => {
    const decision = decideRia(pack("large"), judgement());
    expect(decision.status).toBe("icp_rejected");
    expect(decision.exclusionReason).toBe("large");
  });

  it("builds the ria schema with the 7 signals", () => {
    const schema = JSON.parse(icpSchema("ria")) as { properties: { signals: { required: string[] } } };
    expect(schema.properties.signals.required).toHaveLength(7);
  });

  it("maps states to time zones and picks contacts by group", () => {
    expect(timeZoneForState("TX")).toBe("America/Chicago");
    expect(timeZoneForState("CA")).toBe("America/Los_Angeles");
    const leaders = [
      { name: "A Founder", title: "Founder" },
      { name: "B Ops", title: "Director of Operations" },
    ];
    expect(pickContact(leaders, "R")?.name).toBe("B Ops");
    expect(pickContact(leaders, "P")?.name).toBe("A Founder");
  });
});
