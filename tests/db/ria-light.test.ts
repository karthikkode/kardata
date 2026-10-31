import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, documents, factsCurrent, records, researchRuns, sources } from "../../src/db/schema.js";
import { createFirmDataStep, setPrivateHostsForTests, brochureStep, setReportsBaseForTests, createFeesStep, createContactsStep, signalsStep } from "../../src/domain/ria-steps/handlers.js";
import { addFacts } from "../../src/domain/research/facts.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { storeBlob } from "../../src/domain/research/sources.js";
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";
import { restoreHostDelay, shrinkHostDelay } from "../collect/helpers.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;

const FAKE_PDF_TEXT = [
  "Item 4 Advisory Business",
  "We provide wealth management to individuals and families with discretionary authority over client accounts.",
  "Item 5 Fees and Compensation",
  "Our fee is tiered from 1.00 percent to 0.50 percent, is negotiable, grouped by family, and billed quarterly in advance with proration and refunds of prepaid fees.",
  "Item 9 Disciplinary Information",
  "We have no disciplinary events to report for the firm or its management persons at this time.",
];

function fakePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 11 Tf 72 720 Td ${lines.map((l, i) => `${i === 0 ? "" : "0 -16 Td "}(${esc(l)}) Tj`).join(" ")} ET`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  objs.forEach((o, i) => {
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  pdf += "trailer<</Root 1 0 R>>\n%%EOF\n";
  return Buffer.from(pdf, "utf8");
}

async function makeCompany(over: Record<string, unknown> = {}): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "sec", secCrd: "900001", name: "Light Test Wealth LLC", country: "United States", website: "https://www.linkedin.com/company/x", ...over })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company");
  return row.id;
}

async function makeRun(companyId: string): Promise<string> {
  const [run] = await handle.db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "collect", status: "succeeded", stage: "collect", promptVersion: "ria-light-v1", startedAt: new Date(), finishedAt: new Date() })
    .returning({ id: researchRuns.id });
  if (!run) throw new Error("no run");
  return run.id;
}

async function makeSource(companyId: string, runId: string): Promise<string> {
  const sha = await storeBlob(handle.db, "text/plain", Buffer.from("brochure text", "utf8"));
  const [source] = await handle.db
    .insert(sources)
    .values({ id: randomUUID(), companyId, runId, url: "https://fake.example/adv.pdf", finalUrl: "https://fake.example/adv.pdf", collector: "ria_brochure", status: "ok", blobSha256: sha })
    .returning({ id: sources.id });
  if (!source) throw new Error("no source");
  return source.id;
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
});
beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) => sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"));
  setPrivateHostsForTests(["127.0.0.1"]);
  setReportsBaseForTests(site.baseUrl);
});
afterEach(async () => {
  setPrivateHostsForTests(null);
  setReportsBaseForTests(null);
  await site.close();
});
afterAll(async () => {
  restoreHostDelay(delayPrev);
  await handle.close();
});


describe("firm_data step (B3)", () => {
  it("stores SEC facts and replaces a social website with none", async () => {
    site.routes.set("/search/firm", (_req, res) =>
      sendJson(res, { hits: { hits: [{ _source: { firm_source_id: "900001", firm_ia_disclosure_fl: "N", firm_ia_scope: "ACTIVE", ia_firm_name: "Light Test Wealth LLC" } }] } }),
    );
    site.routes.set("/reports/ADV/900001/PDF/900001.pdf", (_req, res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(fakePdf(["Jane Test - Chief Compliance Officer"]));
    });
    const companyId = await makeCompany();
    const step = createFirmDataStep({
      gdelt: site.baseUrl, secEfts: site.baseUrl, secData: site.baseUrl,
      adviserApi: site.baseUrl, adviserReports: site.baseUrl,
      cdx: site.baseUrl, wayback: site.baseUrl, greenhouse: site.baseUrl,
      lever: site.baseUrl, ashby: site.baseUrl, workable: site.baseUrl, companiesHouse: site.baseUrl,
    } as never);
    const out = await step(handle.db, randomUUID(), companyId);
    expect(out.status).toBe("done");
    const [company] = await handle.db.select().from(companies).where(eq(companies.id, companyId));
    expect(company?.website).toBeNull();
    const facts = await handle.db.select().from(factsCurrent).where(eq(factsCurrent.companyId, companyId));
    expect(facts.map((f) => f.key)).toContain("firm.disclosure_flag");
  });

  it("gaps when the firm has no CRD", async () => {
    const companyId = await makeCompany({ secCrd: null });
    const out = await createFirmDataStep()(handle.db, randomUUID(), companyId);
    expect(out).toMatchObject({ status: "gap", reason: "no SEC CRD" });
  });
});

describe("brochure step (B4)", () => {
  it("stores Item documents from a readable PDF", async () => {
    site.routes.set("/reports/ADV/900001/Part2ABrochure/900001.pdf", (_req, res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(fakePdf(FAKE_PDF_TEXT));
    });
    const companyId = await makeCompany();
    const out = await brochureStep(handle.db, randomUUID(), companyId);
    expect(out.status).toBe("done");
    const docs = await handle.db.select().from(documents).where(eq(documents.companyId, companyId));
    expect(docs.map((d) => d.path).sort()).toEqual([
      "financials/brochure-item-4.md",
      "financials/brochure-item-5.md",
      "financials/brochure-item-9.md",
    ]);
  });

  it("gaps (never fails) when the brochure is not downloadable", async () => {
    const companyId = await makeCompany();
    const out = await brochureStep(handle.db, randomUUID(), companyId);
    expect(out.status).toBe("gap");
    expect(out.reason).toContain("not publicly downloadable");
  });
});

describe("fees step (B5)", () => {
  it("writes only quote-grounded fee facts from one call", async () => {
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    const item5 = "Our fee is tiered, negotiable, grouped by family, and billed quarterly in advance with proration.";
    await saveDocument(handle.db, { companyId, runId, path: "financials/brochure-item-5.md", title: "Item 5", contentMd: item5, sourceIds: [sourceId], createdBy: "collector:ria_brochure" });
    const step = createFeesStep(async () => ({
      json: {
        fee_schedule: "tiered 1.00% to 0.50%",
        family_grouping: true,
        negotiable: true,
        fee_types: ["percentage_of_aum"],
        minimums: "",
        billing: "advance",
        proration: true,
        refunds: false,
        systems: [],
        collection: "deducted from account",
        quotes: {
          fee_schedule: "Our fee is tiered",
          family_grouping: "grouped by family",
          negotiable: "negotiable",
          fee_types: "Our fee is tiered",
          billing: "billed quarterly in advance",
          proration: "with proration",
          collection: "invented passage not in the text",
        },
      },
      usage: { inputTokens: 1234, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, calls: 1 },
    }));
    const out = await step(handle.db, randomUUID(), companyId);
    expect(out).toMatchObject({ status: "done", tokensUsed: 1234 });
    const facts = await handle.db.select().from(factsCurrent).where(eq(factsCurrent.companyId, companyId));
    const keys = facts.map((f) => f.key);
    expect(keys).toContain("firm.fee_schedule");
    expect(keys).toContain("firm.fee_negotiable");
    expect(keys).not.toContain("firm.fee_collection");
  });

  it("gaps without a stored Item 5", async () => {
    const companyId = await makeCompany();
    const out = await createFeesStep(async () => ({ json: {}, usage: undefined }))(handle.db, randomUUID(), companyId);
    expect(out).toMatchObject({ status: "gap", reason: "no brochure Item 5 stored" });
  });
});

describe("contacts step (B6)", () => {
  it("stores leaders from the team page via one call", async () => {
    site.routes.set("/", (_req, res) => sendText(res, `<html><a href="/team">Our Team</a></html>`));
    site.routes.set("/team", (_req, res) =>
      sendText(res, `<html><body>${"Meet the team. ".repeat(30)} Jane Test is Chief Operating Officer. John Roe is Founder and Managing Partner.</body></html>`),
    );
    const companyId = await makeCompany({ website: `${site.baseUrl}/` });
    const step = createContactsStep(async () => ({
      json: { people: [{ name: "Jane Test", title: "Chief Operating Officer", quote: "Jane Test is Chief Operating Officer" }] },
      usage: { inputTokens: 500, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, calls: 1 },
    }));
    const out = await step(handle.db, randomUUID(), companyId);
    expect(out.status).toBe("done");
    const leaders = await handle.db.select().from(records).where(eq(records.companyId, companyId));
    expect(leaders).toHaveLength(1);
    expect(leaders[0]?.data).toMatchObject({ name: "Jane Test" });
  });

  it("gaps when the firm has no website", async () => {
    const companyId = await makeCompany({ website: null });
    const out = await createContactsStep(async () => ({ json: { people: [] }, usage: undefined }))(handle.db, randomUUID(), companyId);
    expect(out).toMatchObject({ status: "gap", reason: "no firm website" });
  });
});

describe("signals step (B7)", () => {
  it("writes a code-only verdict from stored facts", async () => {
    const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
    const { sector } = await createSector(handle.db, { name: "ria-b7", profile });
    const companyId = await makeCompany();
    const runId = await makeRun(companyId);
    const sourceId = await makeSource(companyId, runId);
    await addFacts(handle.db, {
      companyId,
      runId,
      createdBy: "extractor:ria_fees",
      facts: [
        { key: "firm.fee_family_grouping", value: true, sourceIds: [sourceId] },
        { key: "firm.fee_negotiable", value: true, sourceIds: [sourceId] },
        { key: "firm.custodians", value: "Fidelity, Charles Schwab", sourceIds: [sourceId] },
        { key: "firm.regulatory_aum", value: 100_000_000, asOf: "2024-01-01", sourceIds: [sourceId] },
        { key: "firm.regulatory_aum", value: 130_000_000, asOf: "2025-01-01", sourceIds: [sourceId] },
      ],
    });
    const out = await signalsStep(handle.db, sector.id, companyId);
    expect(out.status).toBe("done");
    const counts = (await handle.db.execute(sql`SELECT status FROM company_icp_checks WHERE company_id = ${companyId}`)) as unknown as { status: string }[];
    expect(counts).toHaveLength(1);
    const verdicts = (await handle.db.execute(sql`SELECT score, signals FROM company_verdicts WHERE company_id = ${companyId}`)) as unknown as { score: number; signals: Record<string, boolean> }[];
    expect(verdicts[0]?.signals).toMatchObject({ fee_complexity: true, multi_custodian: true, growth: true });
    expect(verdicts[0]?.score).toBeGreaterThanOrEqual(3);
  });
});
