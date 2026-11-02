import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { documents, sources, riaStepRuns } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { saveDocument } from "../research/documents.js";
import { blobText } from "../research/reads.js";
import { opsPrompt } from "./handlers.js";
import { BROCHURE_ITEMS, splitBrochureItems, FULL_BROCHURE_PATH, FULL_BROCHURE_CAP, FULL_BROCHURE_GAP } from "./brochure.js";
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
  mode?: "sections" | "full_text";
  brochureGap?: string;
}
const itemPath = (item: string) => `financials/brochure-item-${item}.md`;
const promptItems = ["5", "4", "12", "15", "8", "14"];
function operationsInput(items: Record<string, string>) {
  return opsPrompt(promptItems.filter((item) => (items[item]?.trim().length ?? 0) >= 40).map((item) => ({ item, text: items[item] as string })));
}

async function invalidate(db: Db, sectorId: string, companyId: string, ops: boolean, gap?: string, version?: string) {
  for (const step of ["brochure", ...(ops ? ["ops_read"] as const : []), "signals"] as const) {
    const [prior] = await db.select().from(riaStepRuns).where(and(eq(riaStepRuns.sectorId, sectorId), eq(riaStepRuns.companyId, companyId), eq(riaStepRuns.step, step)));
    await recordStep(db, { sectorId, companyId, step,
      status: step === "brochure" ? gap ? "gap" : prior?.status as "done" | "gap" | "failed" ?? "done" : "gap",
      reason: step === "brochure" ? gap ?? (prior?.status === "gap" ? prior.reason : "stored brochure sections repaired") : `stored brochure changed; ${step} refresh required`,
      inputHash: step === "brochure" && version ? version : prior?.inputHash, tokensUsed: prior?.tokensUsed });
  }
}

/** Re-split the current cited PDF (prefer Item 5). No fetch or model. */
export async function repairStoredBrochures(db: Db, input: { sectorId: string; companyIds: string[]; dryRun?: boolean; fullTextFallback?: boolean }) {
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
        inArray(documents.path, [...BROCHURE_ITEMS.map(itemPath), FULL_BROCHURE_PATH])));
      // If an earlier split missed Item 5, another cited section can recover
      // it. The version/content checks below still require one coherent PDF.
      const full = current.find((d) => d.path === FULL_BROCHURE_PATH);
      const anchor = current.find((d) => d.path === itemPath("5")) ?? full ?? current[0];
      const version = anchor?.title.match(/\((\d{4}-\d{2}-\d{2}), v(\d+)\)/);
      if (!anchor || !version || anchor.sourceIds.length !== 1) { result.reason = "no unambiguous stored brochure source/version"; results.push(result); continue; }
      const sourceId = anchor.sourceIds[0] as string;
      result.sourceId = sourceId;
      const [source] = await db.select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.companyId, companyId)));
      if (!source || source.status !== "ok" || source.collector !== "ria_brochure" || !source.blobSha256 ||
        new URL(source.url).searchParams.get("BRCHR_VRSN_ID") !== version[2]) {
        result.reason = "current cited brochure source missing or version mismatch"; results.push(result); continue;
      }
      const citedIds = [...new Set(current.flatMap((d) => d.sourceIds))];
      const cited = await db.select().from(sources).where(and(eq(sources.companyId, companyId), inArray(sources.id, citedIds)));
      // Separate snapshots may cite the exact same immutable PDF bytes. Keep
      // each document's original citation; differing bytes/versions need review.
      if (current.some((d) => !d.title.includes(version[0]) || d.sourceIds.length !== 1) ||
        cited.length !== citedIds.length || cited.some((s) => s.status !== "ok" || s.collector !== "ria_brochure" || s.blobSha256 !== source.blobSha256 || new URL(s.url).searchParams.get("BRCHR_VRSN_ID") !== version[2])) {
        result.reason = "mixed brochure versions or source contents require review"; results.push(result); continue;
      }
      const stored = await blobText(db, source.blobSha256);
      if (!stored) { result.reason = "stored brochure blob missing"; results.push(result); continue; }
      if (full || input.fullTextFallback === true) {
        // Explicit operator fallback for readable prose without reliable Item
        // headings. Keep literal source text; never invent section boundaries.
        if (stored.text.trim().length < 500 || !/[a-z]{3,} [a-z]{3,} [a-z]{3,}/i.test(stored.text.replace(/\s+/g, " "))) {
          result.reason = "stored brochure has insufficient readable prose"; results.push(result); continue;
        }
        if (stored.text.length > FULL_BROCHURE_CAP) {
          result.reason = "stored brochure exceeds bounded whole-text read; source excerpts require review"; results.push(result); continue;
        }
        result.mode = "full_text";
        const stale = (version[1] as string) < new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString().slice(0, 10);
        result.brochureGap = FULL_BROCHURE_GAP + (stale ? "; brochure older than 2 years" : "");
        const sections = current.filter((d) => d.path !== FULL_BROCHURE_PATH);
        result.changedItems = sections.map((d) => BROCHURE_ITEMS.find((item) => itemPath(item) === d.path) as string);
        if (!full || full.contentMd !== stored.text) result.changedItems.push("full_text");
        result.opsRefreshRequired = !full || full.contentMd !== stored.text;
        if (!dryRun && result.changedItems.length) {
          await db.transaction(async (tx) => {
            const latest = await tx.select().from(documents).where(and(eq(documents.companyId, companyId), eq(documents.isCurrent, true),
              inArray(documents.path, [...BROCHURE_ITEMS.map(itemPath), FULL_BROCHURE_PATH]))).for("update");
            if (latest.length !== current.length || current.some((d) => !latest.some((n) => n.id === d.id && n.contentSha256 === d.contentSha256))) throw new Error("brochure changed during fallback; retry preview");
            if (sections.length) await tx.update(documents).set({ isCurrent: false }).where(inArray(documents.id, sections.map((d) => d.id)));
            await saveDocument(tx, { companyId, path: FULL_BROCHURE_PATH, runId: anchor.runId, kind: anchor.kind,
              title: `Part 2A stored brochure text (${version[1]}, v${version[2]})`, contentMd: stored.text, sourceIds: [sourceId],
              createdBy: "collector:ria_brochure", tags: ["brochure:section-boundaries-unavailable"] });
            await invalidate(tx as Db, input.sectorId, companyId, result.opsRefreshRequired, result.brochureGap, version[2]);
          });
          result.applied = true;
        }
        results.push(result); continue;
      }
      result.mode = "sections";
      const items = splitBrochureItems(stored.text);
      const missing = current.filter((d) => !items[BROCHURE_ITEMS.find((i) => itemPath(i) === d.path) as string]);
      if (missing.length) { result.reason = "reparse lost existing sections; manual review required"; results.push(result); continue; }
      result.changedItems = BROCHURE_ITEMS.filter((item) => items[item] !== undefined && current.find((d) => d.path === itemPath(item))?.contentMd !== items[item]);
      const oldItems = Object.fromEntries(current.map((d) => [BROCHURE_ITEMS.find((item) => itemPath(item) === d.path) as string, d.contentMd]));
      result.opsRefreshRequired = operationsInput(oldItems) !== operationsInput(items);
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
              sourceIds: old?.sourceIds ?? [sourceId], factIds: old?.factIds, recordIds: old?.recordIds, tags: old?.tags,
              createdBy: "collector:ria_brochure" });
          }
          await invalidate(tx as Db, input.sectorId, companyId, result.opsRefreshRequired);
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
