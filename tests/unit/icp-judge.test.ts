import { describe, expect, it } from "vitest";
import type { EvidenceItem, EvidencePack } from "../../src/domain/icp/evidence.js";
import {
  buildIcpPrompt,
  decideIcp,
  icpSchema,
  parseJudgement,
  type Judgement,
} from "../../src/domain/icp/judge.js";
import { EXCLUSION_KEYS, FLAG_KEYS, SIGNAL_KEYS, type BucketKey } from "../../src/domain/icp/rules.js";

function item(ref: string, key: string, value: string): EvidenceItem {
  return { ref, kind: ref.startsWith("f:") ? "fact" : "record", key, value, quote: null, url: null, date: "2026-10-01", dateKind: "stated", origin: "grounded" };
}

function pack(fill: Partial<Record<BucketKey, EvidenceItem[]>>, revenue: Partial<EvidencePack["revenue"]> = {}): EvidencePack {
  const buckets = Object.fromEntries(
    [...SIGNAL_KEYS, ...EXCLUSION_KEYS, ...FLAG_KEYS].map((k) => [k, fill[k] ?? []]),
  ) as EvidencePack["buckets"];
  return {
    buckets,
    dropped: { unverified: 0, notesOnly: 0, undated: 0, stale: 0 },
    usable: Object.values(buckets).flat().length,
    companyId: "c",
    sectorId: "s",
    company: { name: "Synthetic Garden Co", domain: "garden.example", country: "United States", employees: 30 },
    preflight: { businessType: "dtc_brand", primaryCategory: "growing", reason: "sells seeds" },
    revenue: { revenueUsed: 5_000_000, revenueSource: "apollo", tier: "B", flags: [], ...revenue },
  };
}

const NO = { verdict: "no" as const, evidence_refs: [], observation: "nothing shown" };
function judgement(patch: {
  signals?: Partial<Judgement["signals"]>;
  exclusions?: Partial<Judgement["exclusions"]>;
  flags?: Partial<Judgement["flags"]>;
}): Judgement {
  return {
    signals: { channels: NO, hiring: NO, revenue_left: NO, review_pain: NO, recent_change: NO, tool_sprawl: NO, ...patch.signals },
    exclusions: {
      data_team: NO,
      parent_company: { ...NO, own_decision_maker: "unknown" },
      not_d2c: NO,
      ...patch.exclusions,
    },
    flags: { tech_team: NO, ...patch.flags },
  };
}

const yes = (refs: string[], observation = "shown") => ({ verdict: "yes" as const, evidence_refs: refs, observation });

const FULL = pack({
  channels: [item("r:1", "retailer", "Garden Mart")],
  hiring: [item("r:2", "job_posting", "Ops Coordinator")],
  tool_sprawl: [item("f:3", "marketing.tool", "Klaviyo"), item("f:4", "marketing.tool", "Omnisend")],
  data_team: [item("r:5", "leader", "Head of Data")],
  parent_company: [item("f:6", "financials.ownership", "owned by BigGroup plc"), item("r:7", "leader", "Founder & CEO")],
});

describe("decideIcp", () => {
  it("scores two independent signals as contactable", () => {
    const d = decideIcp(FULL, judgement({ signals: { channels: yes(["r:1"]), tool_sprawl: yes(["f:3", "f:4"]) } }));
    expect(d).toMatchObject({ score: 2, status: "contactable", exclusionReason: null });
  });

  it("drops a signal that cites refs outside the pack", () => {
    const d = decideIcp(FULL, judgement({ signals: { channels: yes(["r:999"]), tool_sprawl: yes(["f:3"]) } }));
    expect(d.score).toBe(1);
    expect(d.signals.find((s) => s.key === "channels")).toMatchObject({ counted: false, droppedRefs: ["r:999"] });
  });

  it("drops a yes with no evidence", () => {
    const d = decideIcp(FULL, judgement({ signals: { channels: yes([]) } }));
    expect(d.score).toBe(0);
  });

  it("puts a lone hiring signal on the watchlist", () => {
    const d = decideIcp(FULL, judgement({ signals: { hiring: yes(["r:2"]) } }));
    expect(d).toMatchObject({ score: 1, status: "watchlist" });
  });

  it("counts two signals resting on the same job post once", () => {
    const shared = pack({ hiring: [item("r:2", "job_posting", "Inventory planner, Excel")], revenue_left: [item("r:2", "job_posting", "Inventory planner, Excel")] });
    const d = decideIcp(shared, judgement({ signals: { hiring: yes(["r:2"]), revenue_left: yes(["r:2"]) } }));
    expect(d.score).toBe(1);
    expect(d.signals.find((s) => s.key === "revenue_left")?.note).toMatch(/same evidence/);
  });

  it("excludes a company with a data team", () => {
    const d = decideIcp(FULL, judgement({
      signals: { channels: yes(["r:1"]), tool_sprawl: yes(["f:3"]) },
      exclusions: { data_team: yes(["r:5"], "Head of Data on staff") },
    }));
    expect(d.status).toBe("excluded");
    expect(d.exclusionReason).toMatch(/^Has a data team: Head of Data/);
  });

  it("excludes a multi-brand parent, unless the brand has its own decision maker", () => {
    const owned = decideIcp(FULL, judgement({ exclusions: { parent_company: { ...yes(["f:6"]), own_decision_maker: "no" } } }));
    expect(owned.status).toBe("excluded");
    const kept = decideIcp(FULL, judgement({
      signals: { channels: yes(["r:1"]), tool_sprawl: yes(["f:3"]) },
      exclusions: { parent_company: { ...yes(["f:6", "r:7"]), own_decision_maker: "yes" } },
    }));
    expect(kept.status).toBe("contactable");
    expect(kept.exclusions.find((e) => e.key === "parent_company")?.note).toMatch(/D-28/);
  });

  it("excludes revenue under $500k", () => {
    const small = pack({ channels: [item("r:1", "retailer", "Shop")], tool_sprawl: [item("f:3", "marketing.tool", "Klaviyo")] }, { revenueUsed: 300_000, tier: null });
    const d = decideIcp(small, judgement({ signals: { channels: yes(["r:1"]), tool_sprawl: yes(["f:3"]) } }));
    expect(d).toMatchObject({ status: "excluded", exclusionReason: "below $500k revenue: not contacted" });
  });

  it("never counts a signal resting only on research notes, but lets notes exclude", () => {
    const notes = (ref: string, key: string, value: string): EvidenceItem => ({ ...item(ref, key, value), origin: "notes" });
    const p = pack({
      channels: [notes("f:n1", "business_model.marketplace", "Amazon")],
      tool_sprawl: [item("f:3", "marketing.tool", "Klaviyo")],
      parent_company: [notes("f:n2", "financials.ownership", "subsidiary of a listed group")],
    });
    const d = decideIcp(p, judgement({
      signals: { channels: yes(["f:n1"]), tool_sprawl: yes(["f:3"]) },
      exclusions: { parent_company: { ...yes(["f:n2"]), own_decision_maker: "no" } },
    }));
    expect(d.signals.find((s) => s.key === "channels")).toMatchObject({ counted: false, note: expect.stringMatching(/research-note/) });
    expect(d.score).toBe(1);
    expect(d.status).toBe("excluded");
    expect(buildIcpPrompt(p)).toContain("from research notes, not matched to a stored page");
  });

  it("keeps the tech team as a flag, not an exclusion", () => {
    const withTech = pack({ ...FULL.buckets, tech_team: [item("r:8", "job_posting", "Software Engineer")] });
    const d = decideIcp(withTech, judgement({
      signals: { channels: yes(["r:1"]), tool_sprawl: yes(["f:3"]) },
      flags: { tech_team: yes(["r:8"]) },
    }));
    expect(d.status).toBe("contactable");
    expect(d.flags[0]).toMatchObject({ key: "tech_team", counted: true });
  });
});

describe("prompt and schema", () => {
  it("renders every question and every evidence ref", () => {
    const prompt = buildIcpPrompt(FULL);
    for (const key of [...SIGNAL_KEYS, ...EXCLUSION_KEYS, ...FLAG_KEYS]) expect(prompt).toContain(`\`${key}\``);
    for (const ref of ["r:1", "r:2", "f:3", "r:5", "f:6"]) expect(prompt).toContain(`[${ref}]`);
    expect(prompt).toContain("Synthetic Garden Co");
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    expect(prompt).toContain("(no usable evidence stored)");
  });

  it("schema requires every key, and parsing rejects a missing one", () => {
    const schema = JSON.parse(icpSchema()) as { properties: Record<string, { required: string[] }> };
    expect(schema.properties.signals?.required).toEqual([...SIGNAL_KEYS]);
    expect(schema.properties.exclusions?.required).toEqual([...EXCLUSION_KEYS]);
    expect(schema.properties.flags?.required).toEqual([...FLAG_KEYS]);
    const ok = judgement({});
    expect(parseJudgement(ok)).toEqual(ok);
    const bad = { ...ok, signals: { ...ok.signals, hiring: undefined } };
    expect(() => parseJudgement(bad)).toThrow(/signals.hiring/);
  });
});
