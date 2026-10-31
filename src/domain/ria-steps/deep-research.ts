import type { Db } from "../../db/client.js";
import { DomainError } from "../errors.js";
import { startCompanyJob } from "../../runs/company.js";
import { eligibleCompanyIds } from "./status.js";

/**
 * Deep research, opt-in (Stage 5.8 B8): a named list only. The light steps
 * are the default RIA path; a firm gets a research run only when an operator
 * names it here. The ria-v1 prompt reads the stored step data first and
 * researches only what code cannot get (deals, ops job posts, recent news).
 */

export const MAX_DEEP_RESEARCH_FIRMS = 50;

export interface DeepResearchOutcome {
  queued: { companyId: string; jobId: string }[];
  rejected: { companyId: string; reason: string }[];
}

export async function queueRiaDeepResearch(
  db: Db,
  input: { sectorId: string; companyIds: string[] },
): Promise<DeepResearchOutcome> {
  if (input.companyIds.length === 0) {
    throw new DomainError("invalid_input", "deep research needs a named list of companies (the light path is the default)");
  }
  if (input.companyIds.length > MAX_DEEP_RESEARCH_FIRMS) {
    throw new DomainError("invalid_input", `deep research is for a named list of at most ${MAX_DEEP_RESEARCH_FIRMS} firms per call`);
  }
  const eligible = new Set(await eligibleCompanyIds(db, input.sectorId));
  const outcome: DeepResearchOutcome = { queued: [], rejected: [] };
  for (const companyId of input.companyIds) {
    if (!eligible.has(companyId)) {
      outcome.rejected.push({ companyId, reason: "not an eligible member of the sector" });
      continue;
    }
    try {
      const { jobId } = await startCompanyJob(db, { companyId, sectorId: input.sectorId });
      outcome.queued.push({ companyId, jobId });
    } catch (err) {
      outcome.rejected.push({ companyId, reason: err instanceof Error ? err.message.slice(0, 200) : "could not start job" });
    }
  }
  return outcome;
}
