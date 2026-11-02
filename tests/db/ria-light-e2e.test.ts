import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies } from "../../src/db/schema.js";
import {
  brochureStep,
  createContactsStep,
  createOpsReadStep,
  createFirmDataStep,
  setPrivateHostsForTests,
  setBrochureBasesForTests,
  signalsStep,
} from "../../src/domain/ria-steps/handlers.js";
import { runRiaStep, type StepHandlers } from "../../src/domain/ria-steps/runner.js";
import { riaStatus } from "../../src/domain/ria-steps/status.js";
import { riaSheetRows } from "../../src/domain/icp/sheet.js";
import { importSec } from "../../src/domain/imports.js";
import { deriveCompany } from "../../src/domain/sector-preflight/eligibility.js";
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";
import { restoreHostDelay, shrinkHostDelay } from "../collect/helpers.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;
const fixture = join(process.cwd(), "tests/fixtures/sec-sample.csv");

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

const BROCHURE = [
  "Item 4 Advisory Business",
  "We provide wealth management to individuals and families with discretionary authority over client accounts.",
  "Item 5 Fees and Compensation",
  "Our fee is tiered from 1.00 percent to 0.50 percent, is negotiable,",
  "grouped by family, and billed quarterly in advance with proration",
  "and refunds of prepaid fees, deducted from the account.",
  "Item 9 Disciplinary Information",
  "We have no disciplinary events to report for the firm or its management persons at this time.",
];

const usage = { inputTokens: 900, outputTokens: 10, cachedTokens: 0, reasoningTokens: 0, calls: 1 };

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
});
beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) => sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"));
  site.routes.set("/search/firm", (_req, res) =>
    sendJson(res, { hits: { hits: [{ _source: { firm_source_id: "900001", firm_ia_disclosure_fl: "N", firm_ia_scope: "ACTIVE", ia_firm_name: "Test Wealth One LLC" } }] } }),
  );
  site.routes.set("/reports/ADV/900001/PDF/900001.pdf", (_req, res) => {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(fakePdf(["Jane Test - Chief Compliance Officer"]));
  });
  const iacontent = JSON.stringify({
    brochures: {
      part2ExemptFlag: "N",
      brochuredetails: [{ brochureVersionID: 424242, brochureName: "FIRM BROCHURE", dateSubmitted: "3/15/2026" }],
    },
  });
  site.routes.set("/search/firm/900001", (_req, res) =>
    sendJson(res, { hits: { hits: [{ _source: { iacontent } }] } }),
  );
  site.routes.set("/IAPD/Content/Common/crd_iapd_Brochure.aspx", (_req, res) => {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(fakePdf(BROCHURE));
  });
  site.routes.set("/", (_req, res) => sendText(res, `<html><a href="/team">Our Team</a></html>`));
  site.routes.set("/team", (_req, res) =>
    sendText(res, `<html><body>${"Meet the team. ".repeat(30)} Jane Test is Chief Operating Officer.</body></html>`),
  );
  setPrivateHostsForTests(["127.0.0.1"]);
  setBrochureBasesForTests(site.baseUrl, site.baseUrl);
});
afterEach(async () => {
  setPrivateHostsForTests(null);
  setBrochureBasesForTests(null, null);
  await site.close();
});
afterAll(async () => {
  restoreHostDelay(delayPrev);
  await handle.close();
});

describe("synthetic RIA sector through the light steps (B9)", () => {
  it("firm data -> brochure -> ops read -> contacts -> signals -> sheet", async () => {
    const db = handle.db;
    const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
    const { sector } = await createSector(db, { name: "ria-light-e2e", profile });
    await importSec(db, sector.id, fixture, { importDirs: fixtureImportDirs() });
    const rows = (await db.execute(sql`SELECT id, sec_crd FROM companies`)) as unknown as { id: string; sec_crd: string }[];
    for (const r of rows) await deriveCompany(db, sector.id, r.id);
    const firm = rows.find((r) => r.sec_crd === "900001");
    if (!firm) throw new Error("missing firm");
    const endpoints = {
      gdelt: site.baseUrl, secEfts: site.baseUrl, secData: site.baseUrl,
      adviserApi: site.baseUrl, adviserReports: site.baseUrl,
      cdx: site.baseUrl, wayback: site.baseUrl, greenhouse: site.baseUrl,
      lever: site.baseUrl, ashby: site.baseUrl, workable: site.baseUrl, companiesHouse: site.baseUrl,
    } as never;
    const handlers: StepHandlers = {
      firm_data: createFirmDataStep(endpoints),
      brochure: brochureStep,
      ops_read: createOpsReadStep(async () => ({
        json: {
          fee_schedule: "tiered 1.00% to 0.50%",
          family_grouping: true,
          negotiable: true,
          fee_types: ["percentage_of_aum", "flat"],
          minimums: "",
          billing: "advance",
          proration: true,
          refunds: true,
          systems: [],
          collection: "deducted from the account",
          quotes: [
            { field: "fee_schedule", quote: "Our fee is tiered" },
            { field: "family_grouping", quote: "grouped by family" },
            { field: "negotiable", quote: "is negotiable" },
            { field: "fee_types", quote: "Our fee is tiered" },
            { field: "billing", quote: "billed quarterly in advance" },
            { field: "proration", quote: "with proration" },
            { field: "refunds", quote: "refunds of prepaid fees" },
            { field: "collection", quote: "deducted from the account" },
          ],
        },
        usage,
      })),
      contacts: createContactsStep(async () => ({
        json: { people: [{ name: "Jane Test", title: "Chief Operating Officer", quote: "Jane Test is Chief Operating Officer" }] },
        usage,
      })),
      signals: signalsStep,
    };

    for (const step of ["firm_data", "brochure", "ops_read"] as const) {
      const out = await runRiaStep(db, { sectorId: sector.id, step, companyIds: [firm.id] }, handlers);
      expect(out.failed, step).toBe(0);
      expect(out.done + out.skippedDone, step).toBe(1);
    }
    // Point the firm at the fake site now (firm_data normalises websites to domains).
    await db.update(companies).set({ website: `${site.baseUrl}/` }).where(eq(companies.id, firm.id));
    for (const step of ["contacts", "signals"] as const) {
      const out = await runRiaStep(db, { sectorId: sector.id, step, companyIds: [firm.id] }, handlers);
      expect(out.failed, step).toBe(0);
      expect(out.done + out.skippedDone, step).toBe(1);
    }
    const view = await riaStatus(db, sector.id);
    for (const step of ["firm_data", "brochure", "ops_read"] as const) {
      const out = await runRiaStep(db, { sectorId: sector.id, step, companyIds: [firm.id] }, handlers);
      expect(out.failed, step).toBe(0);
      expect(out.done + out.skippedDone, step).toBe(1);
    }
    // Point the firm at the fake site now (firm_data normalises websites to domains).
    await db.update(companies).set({ website: `${site.baseUrl}/` }).where(eq(companies.id, firm.id));
    for (const step of ["contacts", "signals"] as const) {
      expect(view.steps[step].done, step).toBeGreaterThanOrEqual(1);
    }
    const sheet = await riaSheetRows(db, sector.id);
    const row = sheet.find((r) => r.companyId === firm.id);
    expect(row).toBeTruthy();
    expect(row?.feeSummary).toContain("tiered");
    expect(row?.contactName).toBe("Jane Test");
    expect(row?.signals.join(" ")).toContain("Complex fees");
    expect(row?.leadSignal).toBe("Heavy book");
    void randomUUID;
  });
});
