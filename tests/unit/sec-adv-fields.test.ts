import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeSecCsv, extractSecCsv, parseSecCsv } from "../../src/lib/sec/parse.js";
import { SNAPSHOT_FIELDS, snapshotValues } from "../../src/domain/sec-adv/fields.js";

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


it("parses the same synthetic snapshot in a compressed SEC ZIP", () => {
  const zip = readFileSync(new URL("../fixtures/sec-adv-snapshot.zip", import.meta.url));
  const file = extractSecCsv(zip);
  expect(file.csvName).toBe("sec-adv-snapshot.csv");
  expect(parseSecCsv(file.text).rows).toHaveLength(5);
  expect(decodeSecCsv(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
});
