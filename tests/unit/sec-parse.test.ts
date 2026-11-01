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

describe("parseSecCsv main-office fallback", () => {
  it("uses Mail Office, then Books and Records, when the main office is suppressed", () => {
    const header = [
      "Organization CRD#", "SEC#", "Firm Type", "Primary Business Name", "Legal Name",
      "Main Office Street Address 1", "Main Office Street Address 2", "Main Office City", "Main Office State", "Main Office Country",
      "Main Office Postal Code", "Main Office Telephone Number", "Website Address",
      "Mail Office City", "Mail Office State", "Mail Office Country",
      "Location of Books and Records City", "Location of Books and Records State", "Location of Books and Records Country",
      "5A", "5F(2)(c)", "Latest ADV Filing Date", "SEC Current Status",
    ];
    const row = (crd: string, mail: string[], books: string[]) => [
      crd, "801-1", "Registered", `Firm ${crd} LLC`, `Firm ${crd} LLC`,
      "", "", "", "", "", "", "555-0100", "",
      ...mail, ...books,
      "5", "1000000", "03/15/2026", "Approved",
    ];
    const text = [header.join(","), row("700001", ["Westport", "CT", "United States"], ["Lehi", "UT", "United States"]).join(","), row("700002", ["", "", ""], ["Chevy Chase", "MD", "United States"]).join(",")].join("\n");
    const { rows } = parseSecCsv(text);
    const a = rows.find((r) => r.crd === "700001");
    const b = rows.find((r) => r.crd === "700002");
    expect(a).toMatchObject({ city: "Westport", state: "CT", country: "United States" });
    expect(b).toMatchObject({ city: "Chevy Chase", state: "MD", country: "United States" });
  });
});

describe("parseSecCsv Part 1 measures", () => {
  it("reads offices, private fund count, pension and trust clients", () => {
    const header = [
      "Organization CRD#", "Primary Business Name",
      "Number of Other Offices", "Count of Private Funds - 7B(1)",
      "5D(f)(1)", "5D(g)(1)", "5D(a)(1)",
    ];
    const text = [header.join(","), ["800001", "Measures LLC", "3", "7", "40", "25", "100"].join(",")].join("\n");
    const { rows } = parseSecCsv(text);
    expect(rows[0]).toMatchObject({ offices: 4, privateFundCount: 7, pensionClients: 40, trustClients: 25, item11Disclosure: false });
  });

  it("reads Item 11 disclosure answers", () => {
    const header = ["Organization CRD#", "Primary Business Name", "11", "11A(1)", "11C(3)", "11H(2)"];
    const yes = [header.join(","), ["800010", "Disc LLC", "Y", "N", "Y", "N"].join(",")].join("\n");
    expect(parseSecCsv(yes).rows[0]?.item11Disclosure).toBe(true);
    const no = [header.join(","), ["800011", "Clean LLC", "N", "N", "N", "N"].join(",")].join("\n");
    expect(parseSecCsv(no).rows[0]?.item11Disclosure).toBe(false);
  });

  it("leaves the new measures null when the columns are absent", () => {
    const text = ["Organization CRD#,Primary Business Name", "800002,Plain LLC"].join("\n");
    const { rows } = parseSecCsv(text);
    expect(rows[0]).toMatchObject({ offices: null, privateFundCount: null, pensionClients: null, trustClients: null });
  });
});
