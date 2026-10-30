import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSecCsv, secFileDate } from "../../src/lib/sec/parse.js";

describe("parseSecCsv", () => {
  it("maps the adviser fields and computes the wealth share", () => {
    const text = readFileSync(resolve("tests/fixtures/sec-sample.csv"), "utf8");
    const { rows, skipped } = parseSecCsv(text);
    expect(skipped).toEqual([{ row: 4, reason: "missing crd" }]);
    expect(rows).toHaveLength(3);
    const one = rows.find((r) => r.crd === "900001");
    expect(one?.name).toBe("Test Wealth One LLC");
    expect(one?.domain).toBe("testwealthone.example");
    expect(one?.employees).toBe(10);
    expect(one?.regulatoryAum).toBe(200_000_000);
    expect(one?.accounts).toBe(120);
    expect(one?.wealthShare).toBeCloseTo(150 / 160);
    expect(one?.compensationTypes).toEqual(["percentage_of_aum", "fixed"]);
    expect(one?.filingDate).toBe("2026-03-15");
    expect(one?.registrationStatus).toBe("Approved");
  });

  it("rejects a file without the CRD header", () => {
    expect(() => parseSecCsv("a,b\n1,2\n")).toThrowError(/Organization CRD#/);
  });
});

describe("secFileDate", () => {
  it("reads iaMMDDYY and iaMMDDYYYY names", () => {
    expect(secFileDate("ia100226.zip")).toBe("2026-10-02");
    expect(secFileDate("ia09012026.csv")).toBe("2026-09-01");
    expect(secFileDate("other.csv")).toBeNull();
  });
});
