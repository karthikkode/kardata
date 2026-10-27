import { describe, expect, it } from "vitest";
import {
  BUCKET_ITEM_MAX,
  buildPack,
  usableOrigin,
  type EvidenceFact,
  type EvidenceRecord,
  type EvidenceSource,
} from "../../src/domain/icp/evidence.js";

const NOW = new Date("2026-10-27T00:00:00Z");
const SRC = "00000000-0000-4000-8000-000000000001";
const sources = new Map<string, EvidenceSource>([
  [SRC, { url: "https://brand.example/page", fetchedAt: new Date("2026-10-20T00:00:00Z") }],
]);

let n = 0;
function id(): string {
  n += 1;
  return `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
}

function fact(patch: Partial<EvidenceFact>): EvidenceFact {
  return {
    id: id(),
    key: "marketing.tool",
    valueText: "Klaviyo",
    valueNum: null,
    valueDate: null,
    valueBool: null,
    valueJson: null,
    currency: null,
    unit: null,
    qualifiers: {},
    asOf: null,
    sourceIds: [SRC],
    verification: "verified",
    quote: "We use Klaviyo",
    createdBy: "extractor:marketing",
    ...patch,
  };
}

function record(patch: Partial<EvidenceRecord>): EvidenceRecord {
  return {
    id: id(),
    type: "job_posting",
    data: { title: "Operations Coordinator", posted_at: "2026-09-01" },
    sourceIds: [SRC],
    verification: "unverified",
    quote: null,
    createdBy: "collector:jobs",
    ...patch,
  };
}

describe("usableOrigin", () => {
  it("accepts grounded rows and collector rows, never mismatches or unchecked extractor rows", () => {
    expect(usableOrigin({ verification: "verified", createdBy: "extractor:x" })).toBe("grounded");
    expect(usableOrigin({ verification: "verified_value", createdBy: "extractor:x" })).toBe("grounded");
    expect(usableOrigin({ verification: "unverified", createdBy: "collector:jobs" })).toBe("collector");
    expect(usableOrigin({ verification: "quote_mismatch", createdBy: "collector:jobs" })).toBeNull();
    expect(usableOrigin({ verification: "doc_only", createdBy: "extractor:x" })).toBeNull();
    expect(usableOrigin({ verification: "unverified", createdBy: "extractor:x" })).toBeNull();
  });
});

describe("buildPack", () => {
  it("drops quote mismatches and unchecked extractor facts", () => {
    const pack = buildPack({
      facts: [
        fact({ verification: "quote_mismatch" }),
        fact({ verification: "doc_only" }),
        fact({ valueText: "Gorgias" }),
      ],
      records: [],
      sources,
      now: NOW,
    });
    expect(pack.buckets.tool_sprawl.map((i) => i.value)).toEqual(["Gorgias"]);
    expect(pack.dropped.unverified).toBe(2);
  });

  it("drops job posts older than 6 months, keeps fresh ones", () => {
    const pack = buildPack({
      facts: [],
      records: [
        record({ data: { title: "Inventory Planner", posted_at: "2026-03-01" } }),
        record({ data: { title: "Ops Assistant", posted_at: "2026-09-15" } }),
      ],
      sources,
      now: NOW,
    });
    expect(pack.buckets.hiring).toHaveLength(1);
    expect(pack.buckets.hiring[0]?.value).toContain("Ops Assistant");
    expect(pack.dropped.stale).toBeGreaterThanOrEqual(1);
  });

  it("dates an undated job post by the day we saw it", () => {
    const pack = buildPack({
      facts: [],
      records: [record({ data: { title: "Warehouse Lead" } })],
      sources,
      now: NOW,
    });
    expect(pack.buckets.hiring[0]).toMatchObject({ date: "2026-10-20", dateKind: "seen" });
  });

  it("drops undated reviews and keeps only low-rated reviews from the last 12 months", () => {
    const pack = buildPack({
      facts: [],
      records: [
        record({ type: "review", data: { text: "Order never arrived", rating: 1 } }),
        record({ type: "review", data: { text: "Late again", rating: 2, date: "2025-06-01" } }),
        record({ type: "review", data: { text: "Love it", rating: 5, date: "2026-10-01" } }),
        record({ type: "review", data: { text: "Out of stock for weeks", rating: 2, date: "2026-08-01" } }),
      ],
      sources,
      now: NOW,
    });
    expect(pack.buckets.review_pain.map((i) => i.value)).toEqual([expect.stringContaining("Out of stock")]);
    expect(pack.dropped.undated).toBeGreaterThanOrEqual(1);
    expect(pack.dropped.stale).toBeGreaterThanOrEqual(1);
  });

  it("drops funding older than 18 months and events without a stated date", () => {
    const pack = buildPack({
      facts: [],
      records: [
        record({ type: "funding_event", data: { round: "Seed", date: "2024-01-10" } }),
        record({ type: "funding_event", data: { round: "Series A", date: "2026-02-01" } }),
        record({ type: "company_event", data: { summary: "Rebrand" } }),
      ],
      sources,
      now: NOW,
    });
    expect(pack.buckets.recent_change.map((i) => i.value)).toEqual([expect.stringContaining("Series A")]);
  });

  it("routes data and engineering titles to the exclusion and flag buckets", () => {
    const pack = buildPack({
      facts: [],
      records: [
        record({ type: "leader", data: { name: "A", title: "Head of Data" } }),
        record({ type: "leader", data: { name: "B", title: "Founder & CEO" } }),
        record({ data: { title: "Senior Software Engineer", posted_at: "2026-10-01" } }),
      ],
      sources,
      now: NOW,
    });
    expect(pack.buckets.data_team.map((i) => i.value)).toEqual([expect.stringContaining("Head of Data")]);
    expect(pack.buckets.parent_company.map((i) => i.value)).toEqual([expect.stringContaining("Founder")]);
    expect(pack.buckets.tech_team.map((i) => i.value)).toEqual([expect.stringContaining("Software Engineer")]);
  });

  it("fills every signal for a fully researched company and counts distinct usable items", () => {
    const pack = buildPack({
      facts: [
        fact({ key: "business_model.marketplace", valueText: "Amazon US" }),
        fact({ key: "business_model.subscription", valueBool: false, valueText: null }),
        fact({ key: "marketing.tool", valueText: "Klaviyo" }),
        fact({ key: "business_model.dtc_store", valueBool: true, valueText: null }),
      ],
      records: [
        record({ data: { title: "Ops Coordinator", posted_at: "2026-10-01" } }),
        record({ type: "review", data: { text: "Shipping took a month", rating: 2, date: "2026-09-01" } }),
        record({ type: "funding_event", data: { round: "Seed", date: "2026-05-01" } }),
      ],
      sources,
      now: NOW,
    });
    for (const key of ["channels", "hiring", "revenue_left", "review_pain", "recent_change", "tool_sprawl", "not_d2c"] as const) {
      expect(pack.buckets[key].length, key).toBe(1);
    }
    expect(pack.usable).toBe(7);
    expect(pack.buckets.channels[0]).toMatchObject({ ref: expect.stringMatching(/^f:/), origin: "grounded" });
  });

  it("caps each bucket, newest first", () => {
    const many = Array.from({ length: BUCKET_ITEM_MAX + 5 }, (_, i) =>
      record({ type: "retailer", data: { name: `Shop ${i}`, date: `2026-0${(i % 9) + 1}-01` } }),
    );
    const pack = buildPack({ facts: [], records: many, sources, now: NOW });
    expect(pack.buckets.channels).toHaveLength(BUCKET_ITEM_MAX);
    expect(pack.buckets.channels[0]?.date).toBe("2026-09-01");
  });
});
