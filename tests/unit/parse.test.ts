import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApolloFileError,
  KNOWN_HEADERS,
  normalizeDomain,
  parseApolloCsv,
  type ParsedCompany,
} from "../../src/lib/apollo/parse.js";

const FIXTURE = join(process.cwd(), "tests/fixtures/apollo-sample.csv");
const BAD_HEADERS = join(process.cwd(), "tests/fixtures/apollo-bad-headers.csv");

function loadFixture(): string {
  return readFileSync(FIXTURE, "utf8");
}

function byId(rows: ParsedCompany[], id: string): ParsedCompany {
  const found = rows.find((r) => r.apolloAccountId === id);
  if (!found) throw new Error(`missing fixture row ${id}`);
  return found;
}

describe("apollo parser on the synthetic fixture", () => {
  it("carries the real 47 headers plus one unknown column", () => {
    const header = loadFixture().split("\n")[0] ?? "";
    const names = header.split(",");
    expect(names.slice(0, 47)).toEqual([...KNOWN_HEADERS]);
    expect(names[47]).toBe("Mystery Extra");
  });

  it("parses 30 records into 29 rows and 1 skip", () => {
    const { rows, skipped } = parseApolloCsv(loadFixture());
    expect(rows).toHaveLength(29);
    expect(skipped).toEqual([{ row: 11, reason: "missing apollo id" }]);
  });

  it("handles BOM and CRLF identically", () => {
    const withBomCrlf = "\uFEFF" + loadFixture().replaceAll("\n", "\r\n");
    const a = parseApolloCsv(loadFixture());
    const b = parseApolloCsv(withBomCrlf);
    expect(b.rows).toHaveLength(a.rows.length);
    expect(b.skipped).toEqual(a.skipped);
    expect(b.rows.map((r) => r.apolloAccountId)).toEqual(a.rows.map((r) => r.apolloAccountId));
    expect(byId(b.rows, "AP-1009").technologies).toEqual(["Shopify", "Klaviyo"]);
  });

  it("keeps embedded newlines", () => {
    const { rows } = parseApolloCsv(loadFixture());
    const row = byId(rows, "AP-1002");
    expect(row.shortDescription).toBe("Line one\nLine two");
    expect(row.keywords).toEqual(["bath", "body"]);
  });

  it("maps missing websites to null domains", () => {
    const { rows } = parseApolloCsv(loadFixture());
    for (const id of ["AP-1003", "AP-1004"]) {
      expect(byId(rows, id).website).toBeNull();
      expect(byId(rows, id).domain).toBeNull();
    }
  });

  it("derives the same domain from different website spellings", () => {
    const { rows } = parseApolloCsv(loadFixture());
    expect(byId(rows, "AP-1005").domain).toBe("shared-fixture.example");
    expect(byId(rows, "AP-1006").domain).toBe("shared-fixture.example");
  });

  it("returns the same id twice (dedup is the importer's job)", () => {
    const { rows } = parseApolloCsv(loadFixture());
    const dupes = rows.filter((r) => r.apolloAccountId === "AP-1007");
    expect(dupes.map((r) => r.name)).toEqual(["Duplicate First", "Duplicate Second"]);
  });

  it("dedupes lists case-insensitively and drops blanks", () => {
    const { rows } = parseApolloCsv(loadFixture());
    const row = byId(rows, "AP-1009");
    expect(row.technologies).toEqual(["Shopify", "Klaviyo"]);
    expect(row.keywords).toEqual(["serum", "moisturizer"]);
  });

  it("strips $ and commas from numbers; malformed becomes null", () => {
    const { rows } = parseApolloCsv(loadFixture());
    const row = byId(rows, "AP-1010");
    expect(row.employees).toBe(1250);
    expect(row.totalFunding).toBe("1200000");
    expect(row.annualRevenue).toBeNull();
    expect(row.latestFundingAmount).toBeNull();
    expect(row.foundedYear).toBeNull();
    expect(row.lastRaisedAt).toBeNull();
  });

  it("keeps unknown columns in raw only", () => {
    const { rows } = parseApolloCsv(loadFixture());
    const row = byId(rows, "AP-1027");
    expect(row.raw["Mystery Extra"]).toBe("surprise!");
    expect("mysteryExtra" in row).toBe(false);
  });

  it("keeps raw verbatim", () => {
    const { rows } = parseApolloCsv(loadFixture());
    expect(byId(rows, "AP-1010").raw["Total Funding"]).toBe("$1,200,000");
  });
});

describe("apollo parser edge cases", () => {
  it("throws a file error when a required header is missing", () => {
    const text = readFileSync(BAD_HEADERS, "utf8");
    expect(() => parseApolloCsv(text)).toThrowError(ApolloFileError);
    expect(() => parseApolloCsv(text)).toThrowError(/Apollo Account Id/);
  });

  it("throws a file error on unparseable CSV", () => {
    expect(() => parseApolloCsv('Company Name,Apollo Account Id\n"oops')).toThrowError(ApolloFileError);
  });

  it("validates calendar dates on minimal headers", () => {
    const text = "Company Name,Apollo Account Id,Last Raised At\nA,AP-1,2024-02-30\nB,AP-2,2024-01-31\n";
    const { rows } = parseApolloCsv(text);
    expect(rows[0]?.lastRaisedAt).toBeNull();
    expect(rows[1]?.lastRaisedAt).toBe("2024-01-31");
  });

  it("normalizes domains", () => {
    expect(normalizeDomain("https://WWW.Example.COM/a?b=1")).toBe("example.com");
    expect(normalizeDomain("http://www.graftons.co.uk")).toBe("graftons.co.uk");
    expect(normalizeDomain("//cdn.example/shop")).toBe("cdn.example");
    expect(normalizeDomain("plain.example")).toBe("plain.example");
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain("https://")).toBeNull();
  });
});
