import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, documents, factsCurrent, records, researchRuns, sources } from "../../src/db/schema.js";
import { createFirmDataStep, setPrivateHostsForTests } from "../../src/domain/ria-steps/handlers.js";
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
});
afterEach(async () => {
  setPrivateHostsForTests(null);
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
