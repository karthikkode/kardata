import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { secFirmCollector } from "../../src/collect/collectors/sec-firm.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { collectorCtx, factsForRun, recordsForRun, restoreHostDelay, seedCompany, seedRun, shrinkHostDelay } from "./helpers.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "./fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;

const FAKE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>stream\nBT (Jane Test - Chief Compliance Officer) Tj (Custodian: Test Custodian Bank holds assets) Tj ET\nendstream\nendobj\n%%EOF",
  "utf8",
);

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  delayPrev = shrinkHostDelay();
});
beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) => sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"));
});
afterEach(async () => {
  await site.close();
});
afterAll(async () => {
  restoreHostDelay(delayPrev);
  await handle.close();
});

describe("sec_firm collector", () => {
  it("stores filing facts and leader records on ok", async () => {
    const companyId = await seedCompany(handle.db, { secCrd: "777001", name: "Fake Adviser LLC", country: "United States" });
    const runId = await seedRun(handle.db, companyId);
    site.routes.set("/search/firm", (_req, res) =>
      sendJson(res, {
        hits: {
          hits: [
            {
              _source: {
                firm_source_id: "777001",
                firm_ia_disclosure_fl: "N",
                firm_ia_scope: "ACTIVE",
                ia_firm_name: "Fake Adviser LLC",
              },
            },
          ],
        },
      }),
    );
    site.routes.set("/reports/ADV/777001/PDF/777001.pdf", (_req, res) => {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(FAKE_PDF);
    });
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await secFirmCollector.run(ctx);
    expect(result.outcomes).toEqual([
      { area: "financials", status: "done" },
      { area: "decisions", status: "done" },
    ]);
    const facts = await factsForRun(handle.db, runId);
    expect(facts.map((f) => f.key)).toContain("firm.disclosure_flag");
    const records = await recordsForRun(handle.db, runId);
    expect(records.filter((r) => r.type === "leader")).toHaveLength(1);
    expect(site.hits.map((h) => h.userAgent)).toContain("Kardata karthik@kardata.co");
  });

  it("reports not_found when the firm is unknown", async () => {
    const companyId = await seedCompany(handle.db, { secCrd: "777404", name: "Ghost LLC", country: "United States" });
    const runId = await seedRun(handle.db, companyId);
    site.routes.set("/search/firm", (_req, res) => sendJson(res, { hits: { hits: [] } }));
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await secFirmCollector.run(ctx);
    expect(result.outcomes.every((o) => o.status === "not_found")).toBe(true);
  });

  it("reports error when the lookup fails", async () => {
    const companyId = await seedCompany(handle.db, { secCrd: "777500", name: "Broken LLC", country: "United States" });
    const runId = await seedRun(handle.db, companyId);
    site.routes.set("/search/firm", (_req, res) => sendText(res, "boom", 500, "text/plain"));
    const ctx = await collectorCtx(handle.db, site, companyId, runId);
    const result = await secFirmCollector.run(ctx);
    expect(result.outcomes.every((o) => o.status === "error" || o.status === "not_found")).toBe(true);
    expect(result.outcomes[0]?.status).not.toBe("done");
  });
});

describe("extractPdfText null bytes", () => {
  it("strips NUL bytes that Postgres text cannot store", async () => {
    const { extractPdfText } = await import("../../src/collect/collectors/sec-firm.js");
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>stream\nBT (Fee\u0000Schedule) Tj ET\nendstream\nendobj\n%%EOF", "utf8");
    const text = extractPdfText(pdf);
    expect(text).not.toContain("\u0000");
    expect(text).toContain("Fee");
  });
});
