import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, documents, sources, researchRuns } from "../../src/db/schema.js";
import { createSector } from "../../src/domain/sectors.js";
import { importSec } from "../../src/domain/imports.js";
import { deriveCompany } from "../../src/domain/sector-preflight/eligibility.js";
import { storeBlob } from "../../src/domain/research/sources.js";
import { saveDocument } from "../../src/domain/research/documents.js";
import { repairStoredBrochures } from "../../src/domain/ria-steps/brochure-repair.js";
import { recordStep, stepState } from "../../src/domain/ria-steps/status.js";
import { setRiaStepPaused } from "../../src/domain/ria-steps/runner.js";
import { ensureMigrated, fixtureImportDirs, getTestDb, resetTestDb } from "../db.js";
let handle: DbHandle;
beforeAll(async () => { handle = getTestDb(); await ensureMigrated(handle); });
beforeEach(async () => { await resetTestDb(handle); });
afterAll(async () => { await handle.close(); });
const advisory = "We provide discretionary advisory services under written agreements to individual clients and families nationwide.";
const fees = "Annual fees are one percent of assets under management and are billed quarterly in arrears under written agreements.";
async function setup() {
  const profile = JSON.parse(readFileSync(resolve("docs/sectors/ria/profile.json"), "utf8")) as unknown;
  const { sector } = await createSector(handle.db, { name: "Brochure repair", profile });
  await importSec(handle.db, sector.id, resolve("tests/fixtures/sec-sample.csv"), { importDirs: fixtureImportDirs() });
  const firms = await handle.db.select().from(companies);
  for (const firm of firms) await deriveCompany(handle.db, sector.id, firm.id);
  const companyId = firms.find((f) => f.secCrd === "900001")?.id;
  if (!companyId) throw new Error("fixture firm missing");
  const runId = randomUUID(), sourceId = randomUUID();
  const text = ["Item 4 Advisory Business", advisory, "Item 5 Fees and Compensation", fees].join("\n");
  const sha = await storeBlob(handle.db, "text/plain", Buffer.from(text));
  await handle.db.insert(researchRuns).values({ id: runId, companyId, kind: "manual", status: "succeeded" });
  const url = "https://files.example.test/brochure.aspx?BRCHR_VRSN_ID=123";
  await handle.db.insert(sources).values({ id: sourceId, companyId, runId, url, finalUrl: url, collector: "ria_brochure", status: "ok", blobSha256: sha });
  for (const [item, body] of [["4", "Wrong later section that was previously selected."], ["5", fees]]) {
    await saveDocument(handle.db, { companyId, path: `financials/brochure-item-${item}.md`, title: `Part 2A brochure Item ${item} (2026-03-01, v123)`,
      contentMd: body as string, sourceIds: [sourceId], runId, createdBy: "collector:ria_brochure" });
  }
  for (const step of ["brochure", "ops_read", "signals"] as const) await recordStep(handle.db, { sectorId: sector.id, companyId, step, status: "done", inputHash: "old-input" });
  return { sectorId: sector.id, companyIds: [companyId], companyId, sourceId };
}
it("previews without writes, applies only changed sections with original provenance and invalidates dependent stages", async () => {
  const f = await setup();
  const before = await handle.db.select().from(sources).where(eq(sources.id, f.sourceId));
  const opsBefore = await stepState(handle.db, f.sectorId, f.companyId, "ops_read");
  const preview = await repairStoredBrochures(handle.db, f);
  expect(preview).toMatchObject({ dryRun: true, changed: 1, applied: 0, unresolved: 0 });
  expect(preview.results[0]).toMatchObject({ sourceId: f.sourceId, changedItems: ["4"], opsRefreshRequired: true });
  expect(await stepState(handle.db, f.sectorId, f.companyId, "ops_read")).toEqual(opsBefore);
  await expect(repairStoredBrochures(handle.db, { ...f, dryRun: false })).rejects.toThrow("pause and drain");
  await setRiaStepPaused(handle.db, true);
  const applied = await repairStoredBrochures(handle.db, { ...f, dryRun: false });
  expect(applied).toMatchObject({ changed: 1, applied: 1, unresolved: 0 });
  const current = await handle.db.select().from(documents).where(and(eq(documents.companyId, f.companyId), eq(documents.isCurrent, true)));
  expect(current.find((d) => d.path?.endsWith("item-4.md"))).toMatchObject({ contentMd: advisory, sourceIds: [f.sourceId], version: 2 });
  expect(current.find((d) => d.path?.endsWith("item-5.md"))?.version).toBe(1);
  expect(await handle.db.select().from(sources).where(eq(sources.id, f.sourceId))).toEqual(before);
  expect(await stepState(handle.db, f.sectorId, f.companyId, "ops_read")).toMatchObject({ status: "gap", inputHash: "old-input" });
  expect(await stepState(handle.db, f.sectorId, f.companyId, "signals")).toMatchObject({ status: "gap" });
  const after = await stepState(handle.db, f.sectorId, f.companyId, "brochure");
  expect(await repairStoredBrochures(handle.db, { ...f, dryRun: false })).toMatchObject({ changed: 0, applied: 0 });
  expect(await stepState(handle.db, f.sectorId, f.companyId, "brochure")).toEqual(after);
});
it("refuses mismatched source ownership/version and loss of existing sections without partial writes", async () => {
  const f = await setup();
  await setRiaStepPaused(handle.db, true);
  await saveDocument(handle.db, { companyId: f.companyId, path: "financials/brochure-item-8.md", title: "Part 2A brochure Item 8 (2026-03-01, v123)",
    contentMd: "This existing section must never disappear silently after a failed reparse.", sourceIds: [f.sourceId], createdBy: "collector:ria_brochure" });
  const blocked = await repairStoredBrochures(handle.db, { ...f, dryRun: false });
  expect(blocked).toMatchObject({ changed: 0, applied: 0, unresolved: 1 });
  expect(blocked.results[0]?.reason).toContain("lost existing sections");
  await handle.db.update(sources).set({ url: "https://example.test/?BRCHR_VRSN_ID=999" }).where(eq(sources.id, f.sourceId));
  expect((await repairStoredBrochures(handle.db, f)).results[0]?.reason).toContain("version mismatch");
  const other = (await handle.db.select().from(companies)).find((c) => c.id !== f.companyId);
  if (!other) throw new Error("other fixture firm missing");
  await handle.db.update(sources).set({ companyId: other.id }).where(eq(sources.id, f.sourceId));
  expect((await repairStoredBrochures(handle.db, f)).results[0]?.reason).toContain("source missing");
  await expect(repairStoredBrochures(handle.db, { ...f, companyIds: [randomUUID()] })).rejects.toThrow("eligible sector members");
});

it("accepts byte-identical cited snapshots while preserving each original citation", async () => {
  const f = await setup();
  const [original] = await handle.db.select().from(sources).where(eq(sources.id, f.sourceId));
  if (!original) throw new Error("missing source");
  const secondId = randomUUID();
  await handle.db.insert(sources).values({ id: secondId, companyId: f.companyId, runId: original.runId, url: original.url, finalUrl: original.finalUrl,
    collector: original.collector, status: "ok", blobSha256: original.blobSha256 });
  await handle.db.update(documents).set({ sourceIds: [secondId] }).where(and(eq(documents.companyId, f.companyId), eq(documents.path, "financials/brochure-item-4.md")));
  await setRiaStepPaused(handle.db, true);
  expect(await repairStoredBrochures(handle.db, { ...f, dryRun: false })).toMatchObject({ applied: 1, unresolved: 0 });
  const [fixed] = await handle.db.select().from(documents).where(and(eq(documents.companyId, f.companyId), eq(documents.path, "financials/brochure-item-4.md"), eq(documents.isCurrent, true)));
  expect(fixed?.sourceIds).toEqual([secondId]);
  const different = await storeBlob(handle.db, "text/plain", Buffer.from("different filing contents"));
  await handle.db.update(sources).set({ blobSha256: different }).where(eq(sources.id, secondId));
  expect((await repairStoredBrochures(handle.db, f)).results[0]?.reason).toContain("source contents require review");
});
it("preserves successful operations when only text outside the actual supplied prompt changes", async () => {
  const f = await setup();
  const prefix = "Fee disclosure text. ".repeat(2100);
  const sha = await storeBlob(handle.db, "text/plain", Buffer.from(["Item 4 Advisory Business", advisory, "Item 5 Fees and Compensation", prefix + "new tail"].join("\n")));
  await handle.db.update(sources).set({ blobSha256: sha }).where(eq(sources.id, f.sourceId));
  for (const [item, body] of [["4", advisory], ["5", prefix + "old tail"]]) await saveDocument(handle.db, {
    companyId: f.companyId, path: `financials/brochure-item-${item}.md`, title: `Part 2A brochure Item ${item} (2026-03-01, v123)`,
    contentMd: body as string, sourceIds: [f.sourceId], createdBy: "collector:ria_brochure" });
  const before = await stepState(handle.db, f.sectorId, f.companyId, "ops_read");
  await setRiaStepPaused(handle.db, true);
  const result = await repairStoredBrochures(handle.db, { ...f, dryRun: false });
  expect(result).toMatchObject({ changed: 1, applied: 1, unresolved: 0 });
  expect(result.results[0]).toMatchObject({ changedItems: ["5"], opsRefreshRequired: false });
  expect(await stepState(handle.db, f.sectorId, f.companyId, "ops_read")).toEqual(before);
});

it("recovers a previously missed Item 5 from another current section's same filed source", async () => {
  const f = await setup();
  await handle.db.delete(documents).where(and(eq(documents.companyId, f.companyId), eq(documents.path, "financials/brochure-item-5.md")));
  await setRiaStepPaused(handle.db, true);
  const preview = await repairStoredBrochures(handle.db, f);
  expect(preview).toMatchObject({ changed: 1, unresolved: 0 });
  expect(preview.results[0]?.changedItems).toContain("5");
  expect(await repairStoredBrochures(handle.db, { ...f, dryRun: false })).toMatchObject({ applied: 1, unresolved: 0 });
  const [restored] = await handle.db.select().from(documents).where(and(eq(documents.companyId, f.companyId), eq(documents.path, "financials/brochure-item-5.md"), eq(documents.isCurrent, true)));
  expect(restored).toMatchObject({ contentMd: fees, sourceIds: [f.sourceId], title: "Part 2A brochure Item 5 (2026-03-01, v123)" });
});
