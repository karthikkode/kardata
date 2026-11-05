import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeSecCsv, extractSecCsv, parseSecCsv } from "../../src/lib/sec/parse.js";
import { clientTotals, SNAPSHOT_FIELDS, snapshotValues } from "../../src/domain/sec-adv/fields.js";

it("uses the filed count, keeps zeros and false, and skips exact totals on suppressed or missing counts", () => {
  const { rows } = parseSecCsv(readFileSync(new URL("../fixtures/sec-adv-snapshot.csv", import.meta.url), "utf8"));
  const fields = (raw: Record<string, string>) => Object.fromEntries(snapshotValues(raw).map(item => [item.key, item.value]));
  expect(fields(rows[0]!.raw)).toMatchObject({
    "firm.client_total": 30, "firm.client_hnw": 0, "sec_adv.has_website_or_social": false,
    "sec_adv.planning_clients_range": "1-10", "firm.regulatory_aum": 100000000,
  });
  expect(fields(rows[0]!.raw)).not.toHaveProperty(["sec_adv.planning_clients"]);
  expect(fields(rows[2]!.raw)).not.toHaveProperty(["firm.client_total"]);
  expect(fields({ ...rows[0]!.raw, "5D(a)(1)": "" })).not.toHaveProperty(["firm.client_total"]);
  expect(new Set(SNAPSHOT_FIELDS.map(f => f.key)).size).toBe(SNAPSHOT_FIELDS.length);
});

it("bounds only explicitly hidden counts and never fills an unknown category", () => {
  const raw = Object.fromEntries("abcdefghijklmn".split("").map(letter => [`5D(${letter})(1)`, "0"]));
  raw["5D(a)(1)"] = "10";
  expect(clientTotals(raw)).toEqual({ exact: 10, low: 10, high: 10 });
  raw["5D(b)(2)"] = "Y";
  raw["5D(c)(2)"] = "Fewer than 5 Clients";
  expect(clientTotals(raw)).toEqual({ exact: null, low: 12, high: 18 });
  expect(Object.fromEntries(snapshotValues(raw).map(f => [f.key, f.value]))).toMatchObject({
    "firm.client_total_low": 12, "firm.client_total_high": 18,
  });
  raw["5D(d)(1)"] = "";
  expect(clientTotals(raw)).toEqual({ exact: null, low: null, high: null });
  raw["5D(d)(1)"] = "-1";
  expect(clientTotals(raw)).toEqual({ exact: null, low: null, high: null });
});


it("parses the same synthetic snapshot in a compressed SEC ZIP", () => {
  const zip = readFileSync(new URL("../fixtures/sec-adv-snapshot.zip", import.meta.url));
  const file = extractSecCsv(zip);
  expect(file.csvName).toBe("sec-adv-snapshot.csv");
  expect(parseSecCsv(file.text).rows).toHaveLength(5);
  expect(decodeSecCsv(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
});

it("does not infer clients from zero category AUM, even when category AUM reconciles", () => {
  const raw = Object.fromEntries("abcdefghijklmn".split("").flatMap(letter => [
    [`5D(${letter})(1)`, "0"], [`5D(${letter})(3)`, "0"],
  ]));
  raw["5D(a)(1)"] = "10";
  raw["5D(a)(3)"] = "100";
  raw["5F(2)(c)"] = "100";
  // Advisory clients with no regulatory AUM still count (SEC Item 5.C/5.D FAQ).
  raw["5D(b)(1)"] = "7";
  const values = () => Object.fromEntries(snapshotValues(raw).map(item => [item.key, item.value]));
  expect(values()["firm.client_total"]).toBe(17);
  raw["5D(b)(1)"] = "";
  expect(values()).not.toHaveProperty(["firm.client_total"]);
  raw["5D(b)(3)"] = "50";
  expect(values()).not.toHaveProperty(["firm.client_total"]);
});
