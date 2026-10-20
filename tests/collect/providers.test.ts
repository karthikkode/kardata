import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { apolloProfileCollector } from "../../src/collect/collectors/apollo-profile.js";
import { companiesHouseCollector } from "../../src/collect/collectors/companies-house.js";
import { newsCollector } from "../../src/collect/collectors/news.js";
import { secCollector } from "../../src/collect/collectors/sec.js";
import { waybackCollector } from "../../src/collect/collectors/wayback.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import {
  collectorCtx,
  docsForRun,
  factsForRun,
  recordsForRun,
  restoreHostDelay,
  seedCompany,
  seedRun,
  shrinkHostDelay,
} from "./helpers.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "./fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;
let chKeyPrev: string | undefined;
let contactEmailPrev: string | undefined;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
  chKeyPrev = process.env.COMPANIES_HOUSE_API_KEY;
  process.env.COMPANIES_HOUSE_API_KEY = "test-key";
  contactEmailPrev = process.env.KARDATA_CONTACT_EMAIL;
  process.env.KARDATA_CONTACT_EMAIL = "sec-test@example.com";
});

beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) =>
    sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"),
  );
});

afterEach(async () => {
  await site.close();
});

afterAll(async () => {
  restoreHostDelay(delayPrev);
  if (chKeyPrev === undefined) delete process.env.COMPANIES_HOUSE_API_KEY;
  else process.env.COMPANIES_HOUSE_API_KEY = chKeyPrev;
  if (contactEmailPrev === undefined) delete process.env.KARDATA_CONTACT_EMAIL;
  else process.env.KARDATA_CONTACT_EMAIL = contactEmailPrev;
  await handle.close();
});

describe("news collector", () => {
  it("keeps only matching articles and stores news_item records", async () => {
    site.routes.set("/api/v2/doc/doc", (_req, res, url) => {
      expect(url.searchParams.get("mode")).toBe("artlist");
      expect(url.searchParams.get("query")).toBe('"Fake Skin Co"');
      sendJson(res, {
        articles: [
          {
            seendate: "2026-10-18T12:00:00Z",
            domain: "beauty.example",
            title: "Fake Skin Co launches a serum",
            url: "https://beauty.example/fake-skin-co-launch",
          },
          {
            seendate: "2026-10-17T12:00:00Z",
            domain: "other.example",
            title: "Unrelated skincare roundup",
            url: "https://other.example/roundup",
          },
        ],
      });
    });
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Co", domain: "fakeco.example" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await newsCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "decisions", status: "done" }]);

    const docs = await docsForRun(handle.db, runId);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.contentMd).toContain("Unverified mentions — the name may be ambiguous");
    expect(docs[0]?.contentMd).toContain("Fake Skin Co launches a serum");
    expect(docs[0]?.contentMd).not.toContain("Unrelated skincare roundup");

    const recordRows = await recordsForRun(handle.db, runId);
    expect(recordRows).toHaveLength(1);
    expect(recordRows[0]?.type).toBe("news_item");
    expect(recordRows[0]?.data).toMatchObject({
      title: "Fake Skin Co launches a serum",
      outlet: "beauty.example",
      published_at: "2026-10-18",
      verified: false,
    });
    expect(await factsForRun(handle.db, runId)).toHaveLength(0);
  });

  it("reports not_found when nothing matches", async () => {
    site.routes.set("/api/v2/doc/doc", (_req, res) => sendJson(res, { articles: [] }));
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Co", domain: "fakeco.example" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await newsCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "decisions", status: "not_found", reason: "no matching articles (0 returned, none mention the company)" },
    ]);
  });

  it("reports error with the body excerpt when a 200 is not JSON", async () => {
    const body = `<html><body>${"rate limited, try later. ".repeat(20)}</body></html>`;
    site.routes.set("/api/v2/doc/doc", (_req, res) => sendText(res, body, 200, "text/html"));
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Co", domain: "fakeco.example" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await newsCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "decisions", status: "error", reason: body.slice(0, 200) }]);
  });
});

const FORM_D_XML = `<?xml version="1.0"?><edgarSubmission><schemaVersion>X0708</schemaVersion>
<primaryIssuer><cik>0001234567</cik><entityName>Fake Skin Co</entityName>
<issuerAddress><street1>1 Main St</street1><city>Portland</city><stateOrCountry>OR</stateOrCountry></issuerAddress>
</primaryIssuer>
<offeringData><industryGroup><industryGroupType>Other</industryGroupType></industryGroup>
<offeringSalesAmounts><totalOfferingAmount>2000000</totalOfferingAmount><totalAmountSold>1500000</totalAmountSold></offeringSalesAmounts>
<investors><totalNumberAlreadyInvested>12</totalNumberAlreadyInvested></investors>
</offeringData></edgarSubmission>`;

describe("sec collector", () => {
  function seedEdgar(state: string): void {
    site.routes.set("/LATEST/search-index", (_req, res, url) => {
      expect(url.searchParams.get("forms")).toBe("D");
      sendJson(res, {
        hits: {
          hits: [
            {
              _id: "0001234567-25-000001:primary_doc.xml",
              _source: {
                ciks: ["0001234567"],
                display_names: ["Fake Skin Co  (CIK 0001234567)"],
                form: "D",
                file_date: "2025-11-13",
                root_forms: ["D"],
                biz_states: [state],
              },
            },
            {
              _id: "0009999999-25-000001:primary_doc.xml",
              _source: {
                ciks: ["0009999999"],
                display_names: ["Other Corp  (CIK 0009999999)"],
                form: "D",
                file_date: "2025-10-01",
                root_forms: ["D"],
                biz_states: ["TX"],
              },
            },
          ],
        },
      });
    });
    site.fallback = (_req, res, url) => {
      if (url.pathname.startsWith("/Archives/edgar/data/")) {
        sendText(res, FORM_D_XML, 200, "application/xml");
      } else {
        sendText(res, "no such route", 404, "text/plain");
      }
    };
  }

  it("matches name plus state and writes docs, a funding event and the raise date", async () => {
    seedEdgar("OR");
    const companyId = await seedCompany(handle.db, {
      name: "Fake Skin Co",
      country: "United States",
      state: "Oregon",
    });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await secCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "financials", status: "done" },
      { area: "decisions", status: "done" },
    ]);

    const docs = await docsForRun(handle.db, runId);
    expect(docs).toHaveLength(2);
    const financials = docs.find((d) => d.area === "financials")?.contentMd ?? "";
    expect(financials).toContain("Total offering amount: $2,000,000");
    expect(financials).toContain("Amount sold: $1,500,000");
    expect(financials).toContain("Investors: 12");

    const recordRows = await recordsForRun(handle.db, runId);
    expect(recordRows).toHaveLength(1);
    expect(recordRows[0]?.data).toMatchObject({
      date: "2025-11-13",
      amount: 1500000,
      currency: "USD",
      round: "Form D",
    });
    const factRows = await factsForRun(handle.db, runId);
    expect(factRows).toHaveLength(1);
    expect(factRows[0]?.key).toBe("financials.last_raise_date");
    expect(factRows[0]?.valueDate).toBe("2025-11-13");
  });

  it("reports no confident match when the state differs", async () => {
    seedEdgar("CA");
    const companyId = await seedCompany(handle.db, {
      name: "Fake Skin Co",
      country: "United States",
      state: "Oregon",
    });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    // Point the XML at a non-matching state.
    site.fallback = (_req, res, url) => {
      if (url.pathname.startsWith("/Archives/edgar/data/")) {
        sendText(res, FORM_D_XML.replace("<stateOrCountry>OR</stateOrCountry>", "<stateOrCountry>CA</stateOrCountry>"), 200, "application/xml");
      } else {
        sendText(res, "no such route", 404, "text/plain");
      }
    };
    const result = await secCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "financials", status: "not_found", reason: "no confident match" },
      { area: "decisions", status: "not_found", reason: "no confident match" },
    ]);
    const docs = await docsForRun(handle.db, runId);
    expect(docs[0]?.contentMd).toContain("Fake Skin Co — Form D");
  });

  it("skips non-US companies", async () => {
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Co", country: "United Kingdom" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await secCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "financials", status: "skipped", reason: "non-US company (United Kingdom)" },
      { area: "decisions", status: "skipped", reason: "non-US company (United Kingdom)" },
    ]);
    expect(site.hits).toHaveLength(0);
  });

  it("skips US companies without a contact email", async () => {
    const prev = process.env.KARDATA_CONTACT_EMAIL;
    delete process.env.KARDATA_CONTACT_EMAIL;
    try {
      const companyId = await seedCompany(handle.db, { name: "Fake Skin Co", country: "United States" });
      const runId = await seedRun(handle.db, companyId);
      const ctx = await collectorCtx(handle.db, site, companyId, runId);
      const result = await secCollector.run(ctx);
      expect(result.outcomes).toEqual([
        { area: "financials", status: "skipped", reason: "no KARDATA_CONTACT_EMAIL" },
        { area: "decisions", status: "skipped", reason: "no KARDATA_CONTACT_EMAIL" },
      ]);
      expect(site.hits).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.KARDATA_CONTACT_EMAIL;
      else process.env.KARDATA_CONTACT_EMAIL = prev;
    }
  });

  it("sends the SEC contact User-Agent", async () => {
    seedEdgar("OR");
    const companyId = await seedCompany(handle.db, {
      name: "Fake Skin Co",
      country: "United States",
      state: "Oregon",
    });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await secCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "financials", status: "done" },
      { area: "decisions", status: "done" },
    ]);
    const search = site.hits.find((h) => h.path === "/LATEST/search-index");
    const filing = site.hits.find((h) => h.path.startsWith("/Archives/edgar/data/"));
    expect(search?.userAgent).toBe("Kardata <sec-test@example.com>");
    expect(filing?.userAgent).toBe("Kardata <sec-test@example.com>");
  });
});

describe("wayback collector", () => {
  function seedCdx(captures: [string, string][]): void {
    site.routes.set("/cdx/search/cdx", (_req, res, url) => {
      const q = url.searchParams.get("url") ?? "";
      if (q.includes("products.json")) {
        sendJson(res, [
          ["timestamp", "original", "statuscode"],
          ["20241020000000", `${site.baseUrl}/products.json`, "200"],
        ]);
        return;
      }
      sendJson(res, [
        ["timestamp", "original", "statuscode"],
        ...captures.map(([ts, orig]) => [ts, orig, "200"]),
      ]);
    });
  }

  it("counts captures per year and compares the year-old catalog", async () => {
    seedCdx([
      ["20200101000000", "http://fakeco.example/"],
      ["20230601000000", "http://fakeco.example/"],
      ["20250101000000", "http://fakeco.example/"],
    ]);
    site.fallback = (_req, res, url) => {
      if (url.pathname.startsWith("/web/")) {
        sendJson(res, {
          products: [
            { id: 1, title: "Serum", handle: "serum", variants: [{ price: "10.00" }] },
            { id: 9, title: "Gone", handle: "gone", variants: [{ price: "5.00" }] },
          ],
        });
      } else {
        sendText(res, "no such route", 404, "text/plain");
      }
    };
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Co", domain: "fakeco.example" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    ctx.shared.shopify = {
      checked: true,
      isShopify: true,
      products: [
        {
          id: 1,
          title: "Serum",
          productType: "",
          tags: [],
          createdAt: null,
          publishedAt: null,
          handle: "serum",
          variants: [{ price: "20.00" }],
        },
      ],
      collections: [],
      productsUrl: `${site.baseUrl}/products.json`,
    };
    const result = await waybackCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "product", status: "done" },
      { area: "decisions", status: "done" },
    ]);

    const docs = await docsForRun(handle.db, runId);
    const history = docs.find((d) => d.area === "decisions")?.contentMd ?? "";
    expect(history).toContain("First capture: 20200101000000");
    expect(history).toContain("Last capture: 20250101000000");
    expect(history).toContain("- 2020: 1");
    const compare = docs.find((d) => d.area === "product")?.contentMd ?? "";
    expect(compare).toContain("Products added: 0");
    expect(compare).toContain("Products removed: 1");
    expect(compare).toContain("Median variant price: 7.5 → 20");

    const factRows = await factsForRun(handle.db, runId);
    expect(factRows).toHaveLength(1);
    expect(factRows[0]?.key).toBe("product.catalog_change_12m");
    expect(factRows[0]?.valueNum).toBe("-50");
  });

  it("reports no captures, skipping the product comparison", async () => {
    seedCdx([]);
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Co", domain: "fakeco.example" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await waybackCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "product", status: "skipped", reason: "no captures to compare" },
      { area: "decisions", status: "not_found", reason: "no captures" },
    ]);
  });
});

describe("companies_house collector", () => {
  let seenAuth: string | undefined;
  function seedCh(): void {
    seenAuth = undefined;
    site.routes.set("/search/companies", (req, res) => {
      seenAuth = req.headers.authorization;
      sendJson(res, { items: [{ company_number: "12345678", title: "FAKE SKIN LTD" }] });
    });
    site.routes.set("/company/12345678", (_req, res) => {
      sendJson(res, {
        company_number: "12345678",
        company_name: "FAKE SKIN LTD",
        company_status: "active",
        date_of_creation: "2019-04-02",
        sic_codes: ["20420"],
        registered_office_address: { locality: "London", postal_code: "E2 8DP" },
      });
    });
    site.routes.set("/company/12345678/officers", (_req, res) => sendJson(res, { total_results: 3 }));
    site.routes.set("/company/12345678/filing-history", (_req, res) => {
      sendJson(res, { items: [{ category: "accounts", date: "2024-12-31", type: "AA" }] });
    });
  }

  it("matches by name and writes the profile, officers and accounts", async () => {
    seedCh();
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Ltd", country: "United Kingdom" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await companiesHouseCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "financials", status: "done" }]);

    expect(seenAuth).toBe(`Basic ${Buffer.from("test-key:").toString("base64")}`);
    const docs = await docsForRun(handle.db, runId);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.contentMd).toContain("Officers: 3");
    expect(docs[0]?.contentMd).toContain("Latest accounts: 2024-12-31 (AA)");

    const factRows = await factsForRun(handle.db, runId);
    const byKey = new Map(factRows.map((f) => [f.key, f]));
    expect(byKey.get("financials.accounts_type")?.valueText).toBe("AA");
    expect(byKey.get("company.founded_year")?.valueNum).toBe("2019");
  });

  it("skips without a key and reports no confident match", async () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    try {
      const companyId = await seedCompany(handle.db, { name: "Fake Skin Ltd", country: "United Kingdom" });
      const runId = await seedRun(handle.db, companyId);
      const ctx = await collectorCtx(handle.db, site, companyId, runId);
      const skipped = await companiesHouseCollector.run(ctx);
      expect(skipped.outcomes).toEqual([
        { area: "financials", status: "skipped", reason: "COMPANIES_HOUSE_API_KEY not set" },
      ]);
    } finally {
      process.env.COMPANIES_HOUSE_API_KEY = "test-key";
    }

    site.routes.set("/search/companies", (_req, res) => {
      sendJson(res, { items: [{ company_number: "87654321", title: "OTHER LTD" }] });
    });
    site.routes.set("/company/87654321", (_req, res) => {
      sendJson(res, { company_number: "87654321", company_name: "OTHER LTD" });
    });
    const companyId = await seedCompany(handle.db, { name: "Fake Skin Ltd", country: "United Kingdom" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await companiesHouseCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "financials", status: "not_found", reason: "no confident match" }]);
    const docs = await docsForRun(handle.db, runId);
    expect(docs[0]?.contentMd).toContain("OTHER LTD");
  });
});

describe("apollo_profile collector", () => {
  it("writes Apollo proxies labeled as estimates", async () => {
    const companyId = await seedCompany(handle.db, {
      name: "Fake Skin Co",
      annualRevenue: "5000000",
      totalFunding: "2000000",
      employees: 25,
      foundedYear: 2019,
    });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await apolloProfileCollector.run(ctx);
    expect(result.outcomes).toEqual([{ area: "financials", status: "done" }]);
    const docs = await docsForRun(handle.db, runId);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.contentMd).toContain("$5,000,000 (Apollo estimate)");
    expect(docs[0]?.contentMd).toContain("Founded: 2019 (Apollo estimate)");
    // No sources exist for import data, so no facts: the document stands alone.
    expect(await factsForRun(handle.db, runId)).toHaveLength(0);
    expect(site.hits).toHaveLength(0);
  });

  it("reports not_found when no proxies exist", async () => {
    const companyId = await seedCompany(handle.db, { name: "Bare Co" });
    const runId = await seedRun(handle.db, companyId);
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await apolloProfileCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "financials", status: "not_found", reason: "no Apollo financial proxies" },
    ]);
  });
});
