import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { getAdapter } from "../../src/collect/adapters.js";
import { executeCollectRun } from "../../src/collect/run.js";
import { companyJobs, researchRuns, sources } from "../../src/db/schema.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { storeBlob } from "../../src/domain/research/sources.js";
import { icpEvidence } from "../../src/domain/icp/evidence.js";
import { riaSheetRows } from "../../src/domain/icp/sheet.js";
import { importSec } from "../../src/domain/imports.js";
import { createSector } from "../../src/domain/sectors.js";
import { companyRevenueTruth } from "../../src/domain/tiering.js";
import { runExtraction } from "../../src/runs/extract.js";
import { runIcpCheck } from "../../src/runs/icp.js";
import { createSectorRunner, sectorPreflightStatus, startSectorPreflight } from "../../src/runs/sector.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";
import { restoreHostDelay, shrinkHostDelay } from "../collect/helpers.js";
import { sendJson, sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let delayPrev: string | undefined;
const fixture = join(process.cwd(), "tests/fixtures/sec-sample.csv");
const FAKE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>stream\nBT (Jane Test - Chief Compliance Officer) Tj ET\nendstream\nendobj\n%%EOF",
  "utf8",
);
const EXCERPT = "Fees are tiered with family grouping and billed quarterly in advance. Fake Founder leads the firm as Founder.";

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
    sendJson(res, {
      hits: { hits: [{ _source: { firm_source_id: "900001", firm_ia_disclosure_fl: "N", firm_ia_scope: "ACTIVE", ia_firm_name: "Test Wealth One LLC" } }] },
    }),
  );
  site.routes.set("/reports/ADV/900001/PDF/900001.pdf", (_req, res) => {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(FAKE_PDF);
  });
});
afterEach(async () => {
  await site.close();
});
afterAll(async () => {
  restoreHostDelay(delayPrev);
  await handle.close();
});

describe("synthetic RIA sector end to end (Stage 5.7 B7)", () => {
  it("import, preflight, collect, research, extraction, ICP, sheet", async () => {
    const db = handle.db;
    const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
    const { sector } = await createSector(db, { name: "ria-e2e", profile });
    const imported = await importSec(db, sector.id, fixture, { importDirs: fixtureImportDirs() });
    expect(imported.ok).toBe(true);
    const rows = (await db.execute(sql`SELECT id FROM companies WHERE sec_crd = '900001'`)) as unknown as { id: string }[];
    const companyId = rows[0]?.id as string;

    // Preflight with the default classifier: the ria branch returns
    // before any LLM call, so the job completes without Docker.
    const started = await startSectorPreflight(db, { sectorId: sector.id });
    const runner = createSectorRunner(db, { pollMs: 25 });
    await runner.start();
    let finalStatus = await sectorPreflightStatus(db, started.jobId);
    for (let i = 0; i < 100; i++) {
      const done = (finalStatus.counts["done"] ?? 0) + (finalStatus.counts["failed"] ?? 0);
      if (done >= started.companies) break;
      await new Promise((r) => setTimeout(r, 100));
      finalStatus = await sectorPreflightStatus(db, started.jobId);
    }
    await runner.stop();
    expect(finalStatus.counts["failed"] ?? 0).toBe(0);
    const membership = (await db.execute(
      sql`SELECT eligibility, eligibility_reason FROM sector_companies WHERE sector_id = ${sector.id} AND company_id = ${companyId}`,
    )) as unknown as { eligibility: string; eligibility_reason: string }[];
    expect(membership[0]).toMatchObject({ eligibility: "eligible", eligibility_reason: "group:P" });

    // Collect (fake site).
    const [collectRun] = await db
      .insert(researchRuns)
      .values({ id: randomUUID(), companyId, kind: "collect", status: "running", stage: "collect", promptVersion: "ria-v1", requestedAdapters: ["sec_firm"] })
      .returning();
    if (!collectRun) throw new Error("no collect run");
    const adapter = getAdapter("sec_firm");
    if (!adapter) throw new Error("sec_firm adapter missing");
    const collected = await executeCollectRun(db, collectRun.id, {
      endpoints: {
        gdelt: site.baseUrl, secEfts: site.baseUrl, secData: site.baseUrl,
        adviserApi: site.baseUrl, adviserReports: site.baseUrl,
        cdx: site.baseUrl, wayback: site.baseUrl, greenhouse: site.baseUrl,
        lever: site.baseUrl, ashby: site.baseUrl, workable: site.baseUrl, companiesHouse: site.baseUrl,
      },
      privateHostAllowlist: ["127.0.0.1"],
      adapters: [adapter],
    });
    expect(collected.adapters).toContain("sec_firm");

    // Fake-agent research: excerpt source + note, then extraction, then ICP.
    const [job] = await db
      .insert(companyJobs)
      .values({ id: randomUUID(), companyId, sectorId: sector.id })
      .returning();
    if (!job) throw new Error("no job");
    const [run] = await db
      .insert(researchRuns)
      .values({ id: randomUUID(), companyId, companyJobId: job.id, kind: "agent", status: "succeeded", stage: "research", promptVersion: "ria-v1" })
      .returning();
    if (!run) throw new Error("no research run");
    const sha = await storeBlob(db, "text/plain", Buffer.from(EXCERPT, "utf8"));
    const [source] = await db
      .insert(sources)
      .values({ id: randomUUID(), companyId, runId: run.id, url: "https://fake.example/brochure", finalUrl: "https://fake.example/brochure", collector: "sec_firm", status: "ok", blobSha256: sha })
      .returning({ id: sources.id });
    if (!source) throw new Error("no source");
    await saveDocument(db, {
      companyId,
      runId: run.id,
      path: "financials/fees.md",
      title: "Fees",
      contentMd: `# Fees\n\n${EXCERPT} [src:${source.id}]\n`,
      sourceIds: [source.id],
      createdBy: "agent:test",
    });
    const extraction = await runExtraction(db, run, {
      call: async ({ area, prompt }) => {
        const ids = [...prompt.matchAll(/- ([0-9a-f-]{36})/g)].map((m) => m[1] as string);
        const sid = ids.find((id) => id === source.id) ?? ids[0] ?? source.id;
        if (area === "financials") {
          return {
            json: {
              facts: [{
                key: "firm.fee_schedule", value: "tiered with family grouping", unit: null, currency: null,
                qualifiers: [], as_of: null, source_ids: [sid], confidence: "high",
                quote: "Fees are tiered with family grouping and billed quarterly in advance.", quote_source_id: sid,
              }],
              records: [],
              findings: [],
            },
            usage: undefined,
          };
        }
        if (area === "decisions") {
          return {
            json: {
              facts: [],
              records: [{
                type: "leader", data: JSON.stringify({ name: "Fake Founder", title: "Founder" }), natural_key: ["name"],
                source_ids: [sid], quote: "Fake Founder leads the firm as Founder.", quote_source_id: sid,
              }],
              findings: [],
            },
            usage: undefined,
          };
        }
        return { json: { facts: [], records: [], findings: [] }, usage: undefined };
      },
    });
    expect(extraction.areas.every((a) => a.error === null)).toBe(true);

    const pack = await icpEvidence(db, sector.id, companyId);
    const feeRef = pack.buckets["fee_complexity"]?.[0]?.ref;
    expect(feeRef).toBeTruthy();
    const icp = await runIcpCheck(db, {
      sectorId: sector.id,
      companyId,
      companyJobId: job.id,
      call: async () => ({
        json: {
          signals: {
            fee_complexity: { verdict: "yes", evidence_refs: [feeRef], observation: "Tiered fees with family grouping." },
            recent_deal: { verdict: "unknown", evidence_refs: [], observation: "" },
            ops_hiring: { verdict: "unknown", evidence_refs: [], observation: "" },
            multi_custodian: { verdict: "unknown", evidence_refs: [], observation: "" },
            growth: { verdict: "unknown", evidence_refs: [], observation: "" },
            tool_sprawl: { verdict: "unknown", evidence_refs: [], observation: "" },
            fee_problem: { verdict: "unknown", evidence_refs: [], observation: "" },
          },
          exclusions: {},
          flags: {},
        },
        usage: undefined,
      }),
    });
    expect(icp.decision.status).toBe("icp_accepted");
    expect(icp.decision.score).toBeGreaterThanOrEqual(1);

    const truth = await companyRevenueTruth(db, companyId, sector.id);
    expect(truth.tier).toBe("P");
    const sheet = await riaSheetRows(db, sector.id);
    expect(sheet).toHaveLength(1);
    expect(sheet[0]).toMatchObject({ firm: "Test Wealth One LLC", group: "P", contactName: "Fake Founder" });
    void eq;
  });
});
