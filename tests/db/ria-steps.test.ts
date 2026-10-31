import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { recordStep, riaStatus } from "../../src/domain/ria-steps/status.js";
import { importSec } from "../../src/domain/imports.js";
import { deriveCompany } from "../../src/domain/sector-preflight/eligibility.js";
import { createSector } from "../../src/domain/sectors.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;
const fixture = join(process.cwd(), "tests/fixtures/sec-sample.csv");
beforeAll(async () => { handle = getTestDb(); await ensureMigrated(handle); });
beforeEach(async () => { await resetTestDb(handle); });
afterAll(async () => { await handle.close(); });

describe("RIA step status (B1)", () => {
  it("counts done/gap/pending over eligible firms", async () => {
    const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
    const { sector } = await createSector(handle.db, { name: "ria-b1", profile });
    await importSec(handle.db, sector.id, fixture, { importDirs: fixtureImportDirs() });
    const rows = (await handle.db.execute(sql`SELECT id, sec_crd FROM companies`)) as unknown as { id: string; sec_crd: string }[];
    for (const r of rows) await deriveCompany(handle.db, sector.id, r.id);
    const view0 = await riaStatus(handle.db, sector.id);
    expect(view0.eligible).toBe(2);
    const p = rows.find((r) => r.sec_crd === "900001");
    if (!p) throw new Error("missing firm");
    await recordStep(handle.db, { sectorId: sector.id, companyId: p.id, step: "firm_data", status: "done" });
    await recordStep(handle.db, { sectorId: sector.id, companyId: p.id, step: "brochure", status: "gap", reason: "no brochure" });
    const view = await riaStatus(handle.db, sector.id);
    expect(view.steps.firm_data).toMatchObject({ done: 1, pending: 1 });
    expect(view.steps.brochure.gap).toBe(1);
    expect(view.steps.brochure.gapReasons).toEqual({ "no brochure": 1 });
    await recordStep(handle.db, { sectorId: sector.id, companyId: p.id, step: "ops_read", status: "failed", reason: "extractor down" });
    const view2 = await riaStatus(handle.db, sector.id);
    expect(view2.steps.ops_read.failedReasons).toEqual({ "extractor down": 1 });
  });

  it("marks firms absent from the latest file not_current", async () => {
    const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
    const { sector } = await createSector(handle.db, { name: "ria-b1-nc", profile });
    await importSec(handle.db, sector.id, fixture, { importDirs: fixtureImportDirs() });
    // Second file with only one firm: the others are absent from the latest file.
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "sec-nc-"));
    const one = join(dir, "one.csv");
    const lines = readFileSync(fixture, "utf8").split("\n");
    writeFileSync(one, `${lines[0]}\n${lines[1]}\n`);
    await handle.db.transaction(async (tx) => {
      const { importSecOneFile } = await import("../../src/domain/imports.js");
      await importSecOneFile(tx as never, sector.id, one);
    });
    const rows = (await handle.db.execute(sql`SELECT id, sec_crd FROM companies`)) as unknown as { id: string; sec_crd: string }[];
    const absent = rows.find((r) => r.sec_crd === "900002");
    if (!absent) throw new Error("missing firm");
    const triple = await deriveCompany(handle.db, sector.id, absent.id);
    expect(triple).toMatchObject({ eligibility: "ineligible", reason: "not_current" });
  });
});

describe("run_cancel stops extraction (B1)", () => {
  it("stops between areas", async () => {
    const { randomUUID } = await import("node:crypto");
    const { companies, researchRuns, sources } = await import("../../src/db/schema.js");
    const { saveDocument } = await import("../../src/domain/research/documents.js");
    const { storeBlob } = await import("../../src/domain/research/sources.js");
    const { runExtraction } = await import("../../src/runs/extract.js");
    const { cancelRun } = await import("../../src/runs/queue.js");
    const [company] = await handle.db.insert(companies).values({ id: randomUUID(), source: "sec", secCrd: "999001", name: "Cancel Test LLC", country: "United States" }).returning();
    if (!company) throw new Error("no company");
    const [run] = await handle.db.insert(researchRuns).values({ id: randomUUID(), companyId: company.id, kind: "agent", status: "running", stage: "research", promptVersion: "ria-v1" }).returning();
    if (!run) throw new Error("no run");
    const sha = await storeBlob(handle.db, "text/plain", Buffer.from("Fees are tiered.", "utf8"));
    const [source] = await handle.db.insert(sources).values({ id: randomUUID(), companyId: company.id, runId: run.id, url: "https://fake.example/x", finalUrl: "https://fake.example/x", collector: "sec_firm", status: "ok", blobSha256: sha }).returning({ id: sources.id });
    if (!source) throw new Error("no source");
    await saveDocument(handle.db, { companyId: company.id, runId: run.id, path: "financials/fees.md", title: "Fees", contentMd: `Fees are tiered. [src:${source.id}]`, sourceIds: [source.id], createdBy: "agent:test" });
    let calls = 0;
    const outcome = await runExtraction(handle.db, run, {
      call: async () => {
        calls += 1;
        if (calls === 1) await cancelRun(handle.db, run.id);
        return { json: { facts: [], records: [], findings: [] }, usage: undefined };
      },
    });
    expect(calls).toBe(1);
    expect(outcome.areas.filter((a) => a.error === "extraction cancelled").length).toBeGreaterThanOrEqual(1);
  });
});
