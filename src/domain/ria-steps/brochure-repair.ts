import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { documents, sources, riaStepRuns } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { saveDocument } from "../research/documents.js";
import { blobText } from "../research/reads.js";
import { BROCHURE_ITEMS, splitBrochureItems } from "./brochure.js";
import { riaPipelineStatus } from "./pipeline.js";
import { riaStepPaused } from "./runner.js";
import { eligibleCompanyIds, recordStep } from "./status.js";

interface RepairResult {
  companyId: string;
  sourceId?: string;
  changedItems: string[];
  applied: boolean;
  opsRefreshRequired: boolean;
  reason?: string;
}
const itemPath = (item: string) => `financials/brochure-item-${item}.md`;
const promptItems = new Set(["4", "5", "8", "12", "14", "15"]);

/** Re-split only the source cited by the current Item 5. No fetch or model. */
export async function repairStoredBrochures(db: Db, input: { sectorId: string; companyIds: string[]; dryRun?: boolean }) {
  if (input.companyIds.length > 200) throw new DomainError("invalid_input", "at most 200 companies per repair call");
  const ids = [...new Set(input.companyIds)];
  const eligible = new Set(await eligibleCompanyIds(db, input.sectorId));
  if (ids.some((id) => !eligible.has(id))) throw new DomainError("invalid_input", "repair accepts eligible sector members only");
  const dryRun = input.dryRun !== false;
  if (!dryRun) {
    const live = riaPipelineStatus(db);
    if (!await riaStepPaused(db) || live.pipelines.length || live.ai.active || live.collection.active) {
      throw new DomainError("invalid_input", "pause and drain RIA work before applying brochure repairs");
    }
  }
  const results: RepairResult[] = [];
  for (const companyId of ids) {
    const result: RepairResult = { companyId, changedItems: [], applied: false, opsRefreshRequired: false };
    try {
      const current = await db.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.isCurrent, true),
        inArray(documents.path, BROCHURE_ITEMS.map(itemPath))));
      const anchor = current.find((d) => d.path === itemPath("5"));
      const version = anchor?.title.match(/\((\d{4}-\d{2}-\d{2}), v(\d+)\)/);
      if (!anchor || !version || anchor.sourceIds.length !== 1) { result.reason = "no unambiguous current Item 5 source/version"; results.push(result); continue; }
      const sourceId = anchor.sourceIds[0] as string;
      result.sourceId = sourceId;
      const [source] = await db.select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.companyId, companyId)));
      if (!source || source.status !== "ok" || source.collector !== "ria_brochure" || !source.blobSha256 ||
        new URL(source.url).searchParams.get("BRCHR_VRSN_ID") !== version[2]) {
        result.reason = "current cited brochure source missing or version mismatch"; results.push(result); continue;
      }
      if (current.some((d) => !d.title.includes(version[0]) || d.sourceIds.length !== 1 || d.sourceIds[0] !== sourceId)) {
        result.reason = "mixed brochure versions or sources require review"; results.push(result); continue;
      }
      const stored = await blobText(db, source.blobSha256);
      if (!stored) { result.reason = "stored brochure blob missing"; results.push(result); continue; }
      const items = splitBrochureItems(stored.text);
      const missing = current.filter((d) => !items[BROCHURE_ITEMS.find((i) => itemPath(i) === d.path) as string]);
      if (missing.length) { result.reason = "reparse lost existing sections; manual review required"; results.push(result); continue; }
      result.changedItems = BROCHURE_ITEMS.filter((item) => items[item] !== undefined && current.find((d) => d.path === itemPath(item))?.contentMd !== items[item]);
      result.opsRefreshRequired = result.changedItems.some((item) => promptItems.has(item));
      if (!dryRun && result.changedItems.length) {
        await db.transaction(async (tx) => {
          const latest = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.isCurrent, true),
            inArray(documents.path, BROCHURE_ITEMS.map(itemPath)))).for("update");
          if (latest.length !== current.length || current.some((d) => !latest.some((n) => n.id === d.id && n.contentSha256 === d.contentSha256))) {
            throw new Error("brochure changed during repair; retry preview");
          }
          for (const item of result.changedItems) {
            const old = current.find((d) => d.path === itemPath(item));
            await saveDocument(tx, { companyId, path: itemPath(item), runId: anchor.runId, kind: old?.kind ?? anchor.kind,
              title: `Part 2A brochure Item ${item} (${version[1]}, v${version[2]})`, contentMd: items[item] as string,
              sourceIds: [sourceId], factIds: old?.factIds, recordIds: old?.recordIds, tags: old?.tags,
              createdBy: "collector:ria_brochure" });
          }
          // Preserve successful extracted facts/records and their old input hash.
          // Explicitly invalidate dependent stage status until it is refreshed.
          for (const step of ["brochure", ...(result.opsRefreshRequired ? ["ops_read"] as const : []), "signals"] as const) {
            const [prior] = await tx.select().from(riaStepRuns).where(and(eq(riaStepRuns.sectorId, input.sectorId), eq(riaStepRuns.companyId, companyId), eq(riaStepRuns.step, step)));
            await recordStep(tx as Db, { sectorId: input.sectorId, companyId, step,
              status: step === "brochure" ? prior?.status as "done" | "gap" | "failed" ?? "done" : "gap",
              reason: step === "brochure" ? prior?.status === "gap" ? prior.reason : "stored brochure sections repaired" : `stored brochure changed; ${step} refresh required`,
              inputHash: prior?.inputHash, tokensUsed: prior?.tokensUsed });
          }
        });
        result.applied = true;
      }
    } catch (err) {
      result.reason = err instanceof Error ? err.message.slice(0, 200) : "stored brochure repair error";
    }
    results.push(result);
  }
  return { dryRun, considered: ids.length, changed: results.filter((r) => r.changedItems.length).length,
    applied: results.filter((r) => r.applied).length, unresolved: results.filter((r) => r.reason).length, results };
}
