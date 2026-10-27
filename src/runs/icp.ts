import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  companyIcpChecks,
  companyVerdicts,
  researchRuns,
  sectorCompanies,
  type ResearchRun,
} from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { icpEvidence, type EvidenceItem, type EvidencePack } from "../domain/icp/evidence.js";
import {
  ICP_PROMPT_VERSION,
  buildIcpPrompt,
  decideIcp,
  icpSchema,
  incompleteDecision,
  parseJudgement,
  type IcpDecision,
} from "../domain/icp/judge.js";
import { logIcpCall } from "../domain/logging/provider-calls.js";
import { recordVerdicts } from "../domain/tiering.js";
import { dockerClassifierCall, type ClassifierCall } from "./sector-classify.js";

/**
 * One ICP check (Stage 5.5 Step 3): evidence pack, one tool-less Muse call
 * through the classifier harness (same lockdown and Muse settings), the
 * server's decision, an append-only check row, and the verdict.
 */

/** Verdicts recorded by hand with this source prefix are never overwritten by a check. */
export const OVERRIDE_SOURCE_PREFIX = "override:";

export interface RunIcpInput {
  sectorId: string;
  companyId: string;
  runId?: string;
  companyJobId?: string | null;
  call?: ClassifierCall;
  now?: Date;
}

export interface RunIcpOutcome {
  checkId: string;
  runId: string;
  decision: IcpDecision;
  /** False when a manual override verdict was kept. */
  verdictWritten: boolean;
}

export async function createIcpRun(db: Db, companyId: string, companyJobId: string | null = null): Promise<string> {
  const runId = randomUUID();
  await db.insert(researchRuns).values({
    id: runId,
    companyId,
    kind: "icp",
    status: "running",
    startedAt: new Date(),
    stage: "icp",
    companyJobId,
  });
  return runId;
}

function packHash(pack: EvidencePack): string {
  const body = Object.entries(pack.buckets).map(([k, items]) => [k, items.map((i) => [i.ref, i.value, i.date])]);
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

function citedItems(pack: EvidencePack, decision: IcpDecision): EvidenceItem[] {
  const refs = new Set([...decision.signals, ...decision.exclusions, ...decision.flags].flatMap((r) => r.refs));
  const byRef = new Map<string, EvidenceItem>();
  for (const items of Object.values(pack.buckets)) for (const i of items) if (refs.has(i.ref)) byRef.set(i.ref, i);
  return [...byRef.values()];
}

export async function runIcpCheck(db: Db, input: RunIcpInput): Promise<RunIcpOutcome> {
  const [member] = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(and(eq(sectorCompanies.sectorId, input.sectorId), eq(sectorCompanies.companyId, input.companyId)));
  if (!member) throw new DomainError("invalid_input", "company is not in this sector");
  const runId = input.runId ?? (await createIcpRun(db, input.companyId, input.companyJobId ?? null));
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new Error("icp run row is gone");
  const fail = async (error: string): Promise<never> => {
    await db
      .update(researchRuns)
      .set({ status: "failed", error: error.slice(0, 500), finishedAt: new Date() })
      .where(eq(researchRuns.id, runId));
    throw new DomainError("invalid_input", error);
  };
  let pack: EvidencePack;
  try {
    pack = await icpEvidence(db, input.sectorId, input.companyId, input.now);
  } catch (err) {
    return fail(`evidence pack failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let decision: IcpDecision;
  let usage: ResearchRun["agentUsage"] = null;
  if (pack.usable === 0) {
    decision = incompleteDecision();
  } else {
    const prompt = buildIcpPrompt(pack);
    const started = Date.now();
    let result;
    try {
      result = await (input.call ?? dockerClassifierCall)({ runId, prompt, schema: icpSchema() });
    } catch (err) {
      return fail(`icp judge call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await logIcpCall(db, { ...run, status: "running" } as ResearchRun, {
      seq: 1,
      prompt,
      raw: result.raw,
      json: result.json,
      usage: result.usage,
      durationMs: Date.now() - started,
    });
    try {
      decision = decideIcp(pack, parseJudgement(result.json));
    } catch (err) {
      return fail(err instanceof Error ? err.message : "invalid icp judgement");
    }
    if (result.usage) {
      usage = {
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        reasoningTokens: result.usage.reasoningTokens,
        calls: result.usage.calls,
        childrenIncluded: false,
      };
    }
  }
  const checkId = randomUUID();
  await db.insert(companyIcpChecks).values({
    id: checkId,
    companyId: input.companyId,
    sectorId: input.sectorId,
    runId,
    promptVersion: ICP_PROMPT_VERSION,
    packHash: packHash(pack),
    score: decision.score,
    status: decision.status,
    exclusionReason: decision.exclusionReason,
    results: {
      signals: decision.signals,
      exclusions: decision.exclusions,
      flags: decision.flags,
      dropped: pack.dropped,
      usable: pack.usable,
    },
    evidence: citedItems(pack, decision),
    usage: usage as Record<string, unknown> | null,
  });
  const [existing] = await db
    .select({ source: companyVerdicts.source })
    .from(companyVerdicts)
    .where(eq(companyVerdicts.companyId, input.companyId));
  const verdictWritten = !existing?.source.startsWith(OVERRIDE_SOURCE_PREFIX);
  if (verdictWritten) {
    await recordVerdicts(db, [
      {
        companyId: input.companyId,
        sectorId: input.sectorId,
        score: decision.score,
        signals: Object.fromEntries(decision.signals.map((s) => [s.key, s.counted])),
        status: decision.status,
        exclusionReason: decision.exclusionReason,
        source: `${ICP_PROMPT_VERSION}:${checkId}`,
      },
    ]);
  }
  await db
    .update(researchRuns)
    .set({ status: "succeeded", finishedAt: new Date(), agentUsage: usage })
    .where(eq(researchRuns.id, runId));
  return { checkId, runId, decision, verdictWritten };
}

/** The latest check for a company, or null. */
export async function latestIcpCheck(db: Db, companyId: string) {
  const [row] = await db
    .select()
    .from(companyIcpChecks)
    .where(eq(companyIcpChecks.companyId, companyId))
    .orderBy(desc(companyIcpChecks.createdAt))
    .limit(1);
  return row ?? null;
}
