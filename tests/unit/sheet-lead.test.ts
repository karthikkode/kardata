import { describe, expect, it } from "vitest";
import { riaTopSignals } from "../../src/domain/icp/sheet.js";

function check(signals: { key: string; counted: boolean }[]): never {
  return {
    results: { signals: signals.map((s) => ({ ...s, verdict: s.counted ? "yes" : "no", refs: [], observation: s.key, note: null })) },
    evidence: [],
  } as never;
}

describe("riaTopSignals lead = rarest counted signal in the group", () => {
  it("prefers the rarer signal over the fixed priority", () => {
    const freq = new Map([
      ["outside_managers", 0.7],
      ["custody_work", 0.1],
      ["heavy_book", 0.3],
    ]);
    const out = riaTopSignals(
      check([
        { key: "outside_managers", counted: true },
        { key: "custody_work", counted: true },
        { key: "heavy_book", counted: true },
      ]),
      freq,
    );
    expect(out.lead).toBe("Custody work");
    expect(out.top[0]).toContain("Custody work");
  });

  it("breaks rarity ties by the fixed priority", () => {
    const freq = new Map([
      ["outside_managers", 0.2],
      ["custody_work", 0.2],
    ]);
    const out = riaTopSignals(
      check([
        { key: "custody_work", counted: true },
        { key: "outside_managers", counted: true },
      ]),
      freq,
    );
    expect(out.lead).toBe("Outside managers");
  });
});
