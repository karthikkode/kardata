import { and, eq, inArray, like, or } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  area,
  areaStatuses,
  companies,
  documents,
  factKeys,
  facts,
  findings,
  records,
  recordTypes,
  researchRuns,
  runEvents,
  sources,
  webSearches,
} from "../../db/schema.js";
import { normalizeDomain } from "../../lib/apollo/parse.js";
import { DomainError } from "../errors.js";
import { factValueKind } from "./grounding.js";

export interface AreaScore {
  facts: number;
  recordsByType: Record<string, number>;
  reviewsIngested: number;
  documents: number;
  findings: number;
  status: string | null;
  statusReason: string | null;
}

export interface TokenScore {
  model?: string;
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  calls: number;
  childrenIncluded: boolean;
}

/** Output created by agents (createdBy agent:*), excluding the collect phase. */
export interface AgentScore {
  facts: number;
  recordsByType: Record<string, number>;
  reviewsIngested: number;
  documents: number;
  findings: number;
}

/** Output created by the extractor (createdBy extractor:*). Same counters. */
export type ExtractorScore = AgentScore;

/** Grounding verdicts over agent + extractor facts and records. */
export interface VerificationShares {
  verified: number;
  docOnly: number;
  mismatch: number;
  unverified: number;
  verifiedValue: number;
}

/** Web search/fetch activity ingested from the agent session log. */
export interface SearchScore {
  total: number;
  byArea: Record<string, number>;
  /** Share of searches with at least one captured hit (null when total is 0). */
  withCapturePct: number | null;
  museFetchFallbacks: number;
}

export interface RunScore {
  runId: string;
  companyId: string;
  companyName: string | null;
  kind: string;
  status: string;
  promptVersion: string | null;
  minutes: number | null;
  tokens: TokenScore | null;
  mcpCalls: number;
  forbidden: number;
  piiRedactions: number;
  facts: number;
  primaryShare: number | null;
  recordsByType: Record<string, number>;
  reviewsIngested: number;
  documents: number;
  findings: number;
  findingsWellCited: number;
  newProvisionalKeys: string[];
  newProvisionalTypes: string[];
  verification: VerificationShares;
  /** Grounding shares per fact value kind (number, money, date, short_text, bool, long_text, json). */
  verificationByKind: Record<string, VerificationShares>;
  /** Grounding shares per record type. */
  verificationByRecordType: Record<string, VerificationShares>;
  /** Grounding shares per evidence grade (primary | secondary). */
  verificationByGrade: Record<string, VerificationShares>;
  searches: SearchScore;
  agent: AgentScore;
  extractor: ExtractorScore;
  areas: Record<string, AreaScore>;
}

export interface BatchTotals {
  runs: number;
  facts: number;
  recordsByType: Record<string, number>;
  reviewsIngested: number;
  documents: number;
  findings: number;
  verification: VerificationShares;
  verificationByKind: Record<string, VerificationShares>;
  verificationByRecordType: Record<string, VerificationShares>;
  verificationByGrade: Record<string, VerificationShares>;
  searches: SearchScore;
  agent: AgentScore;
  extractor: ExtractorScore;
  mcpCalls: number;
  forbidden: number;
  piiRedactions: number;
  minutes: number;
  runsWithUsage: number;
  tokens: { input: number; output: number; cached: number; reasoning: number; calls: number };
  childrenIncluded: boolean;
}

export interface ScorecardResult {
  runs: RunScore[];
  totals: BatchTotals;
}

const AREA_ORDER = (area.enumValues as readonly string[]).filter((a) => a !== "other");

// Registries and filings count as primary alongside the company's own domain.
const OFFICIAL_API_SUFFIXES = ["sec.gov", "company-information.service.gov.uk"];

export function isPrimarySource(finalUrl: string, companyDomain: string | null): boolean {
  let host: string;
  try {
    host = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (OFFICIAL_API_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  if (!companyDomain) return false;
  const domain = companyDomain.toLowerCase().replace(/^www\./, "");
  const bare = host.replace(/^www\./, "");
  return bare === domain || bare.endsWith(`.${domain}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyArea(): AreaScore {
  return {
    facts: 0,
    recordsByType: {},
    reviewsIngested: 0,
    documents: 0,
    findings: 0,
    status: null,
    statusReason: null,
  };
}

function emptyAgent(): AgentScore {
  return { facts: 0, recordsByType: {}, reviewsIngested: 0, documents: 0, findings: 0 };
}

function emptySearches(): SearchScore {
  return { total: 0, byArea: {}, withCapturePct: null, museFetchFallbacks: 0 };
}

/**
 * An item's evidence grade: its quote source's grade when it has one,
 * else its first cited source's grade. Sources always have a grade.
 */
function itemGrade(
  grades: Map<string, string>,
  quoteSourceId: string | null,
  sourceIds: string[],
): string {
  if (quoteSourceId && grades.has(quoteSourceId)) return grades.get(quoteSourceId) as string;
  for (const id of sourceIds) {
    if (grades.has(id)) return grades.get(id) as string;
  }
  return "primary";
}

function emptyVerification(): VerificationShares {
  return { verified: 0, docOnly: 0, mismatch: 0, unverified: 0, verifiedValue: 0 };
}

function bumpShares(shares: VerificationShares, verification: string): void {
  if (verification === "verified") shares.verified += 1;
  else if (verification === "doc_only") shares.docOnly += 1;
  else if (verification === "quote_mismatch") shares.mismatch += 1;
  else if (verification === "verified_value") shares.verifiedValue += 1;
  else shares.unverified += 1;
}

function bumpVerification(score: RunScore, verification: string): void {
  bumpShares(score.verification, verification);
}

function bumpKindShare(bucket: Record<string, VerificationShares>, key: string, verification: string): void {
  const shares = bucket[key] ?? (bucket[key] = emptyVerification());
  bumpShares(shares, verification);
}

function mergeKindShares(into: Record<string, VerificationShares>, from: Record<string, VerificationShares>): void {
  for (const [key, shares] of Object.entries(from)) {
    const target = into[key] ?? (into[key] = emptyVerification());
    target.verified += shares.verified;
    target.docOnly += shares.docOnly;
    target.mismatch += shares.mismatch;
    target.unverified += shares.unverified;
    target.verifiedValue += shares.verifiedValue;
  }
}

function isAgentMade(createdBy: string): boolean {
  return createdBy.startsWith("agent:");
}

function isExtractorMade(createdBy: string): boolean {
  return createdBy.startsWith("extractor:");
}

function bumpType(into: Record<string, number>, type: string): void {
  into[type] = (into[type] ?? 0) + 1;
}

async function resolveRunIds(db: Db, input: { batchId?: string; runIds?: string[] }): Promise<string[]> {
  if (input.batchId !== undefined) {
    const rows = await db
      .select({ id: researchRuns.id })
      .from(researchRuns)
      .where(eq(researchRuns.batchId, input.batchId));
    if (rows.length === 0) throw new DomainError("not_found", `batch not found: ${input.batchId}`);
    return rows.map((r) => r.id);
  }
  const ids = [...new Set(input.runIds ?? [])];
  if (ids.length === 0) throw new DomainError("invalid_input", "at least one run id is required");
  const rows = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(inArray(researchRuns.id, ids));
  const have = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length > 0) throw new DomainError("not_found", `runs not found: ${missing.join(", ")}`);
  return ids;
}

/**
 * Counts only, from the DB. Records count for a run when first- or last-seen
 * by it; reviews ingested counts review records first-seen by it; registry
 * names count when the run's agent label created them.
 */
export async function scorecard(
  db: Db,
  input: { batchId?: string; runIds?: string[] },
): Promise<ScorecardResult> {
  const runIds = await resolveRunIds(db, input);
  const runs = await db
    .select({
      run: researchRuns,
      companyName: companies.name,
      companyDomain: companies.domain,
      companyOverrides: companies.overrides,
    })
    .from(researchRuns)
    .innerJoin(companies, eq(researchRuns.companyId, companies.id))
    .where(inArray(researchRuns.id, runIds));

  const scores = new Map<string, RunScore>();
  const domains = new Map<string, string | null>();
  for (const { run, companyName, companyDomain, companyOverrides } of runs) {
    const overrides = (companyOverrides ?? {}) as Record<string, unknown>;
    const domain =
      "website" in overrides
        ? normalizeDomain((overrides.website ?? null) as string | null)
        : companyDomain;
    domains.set(run.id, domain);
    const areas: Record<string, AreaScore> = {};
    for (const name of AREA_ORDER) areas[name] = emptyArea();
    const minutes =
      run.startedAt === null
        ? null
        : round2(((run.finishedAt ?? new Date()).getTime() - run.startedAt.getTime()) / 60000);
    const usage = run.agentUsage;
    scores.set(run.id, {
      runId: run.id,
      companyId: run.companyId,
      companyName,
      kind: run.kind,
      status: run.status,
      promptVersion: run.promptVersion,
      minutes,
      tokens: usage
        ? {
            ...(usage.model === undefined ? {} : { model: usage.model }),
            input: usage.inputTokens,
            output: usage.outputTokens,
            cached: usage.cachedTokens,
            reasoning: usage.reasoningTokens,
            calls: usage.calls,
            childrenIncluded: usage.childrenIncluded,
          }
        : null,
      mcpCalls: 0,
      forbidden: 0,
      piiRedactions: 0,
      facts: 0,
      primaryShare: null,
      recordsByType: {},
      reviewsIngested: 0,
      documents: 0,
      findings: 0,
      findingsWellCited: 0,
      newProvisionalKeys: [],
      newProvisionalTypes: [],
      verification: emptyVerification(),
      verificationByKind: {},
      verificationByRecordType: {},
      verificationByGrade: {},
      searches: emptySearches(),
      agent: emptyAgent(),
      extractor: emptyAgent(),
      areas,
    });
  }
  const at = (runId: string): RunScore => {
    const score = scores.get(runId);
    if (!score) throw new Error(`score missing for ${runId}`);
    return score;
  };
  const areaAt = (runId: string, name: string | null): AreaScore => {
    const score = at(runId);
    if (name === null || !(name in score.areas)) return emptyAreaDetached(score, name);
    return score.areas[name] as AreaScore;
  };

  const factRows = await db
    .select({
      runId: facts.runId,
      area: facts.area,
      sourceIds: facts.sourceIds,
      quoteSourceId: facts.quoteSourceId,
      createdBy: facts.createdBy,
      verification: facts.verification,
      valueNum: facts.valueNum,
      valueText: facts.valueText,
      valueDate: facts.valueDate,
      valueBool: facts.valueBool,
      valueJson: facts.valueJson,
    })
    .from(facts)
    .where(inArray(facts.runId, runIds));
  const cited = [...new Set(factRows.flatMap((f) => f.sourceIds))];
  const primaryById = new Map<string, boolean>();
  const gradeById = new Map<string, string>();
  if (cited.length > 0) {
    const sourceRows = await db
      .select({ id: sources.id, companyId: sources.companyId, finalUrl: sources.finalUrl, evidenceGrade: sources.evidenceGrade })
      .from(sources)
      .where(inArray(sources.id, cited));
    const domainByCompany = new Map<string, string | null>();
    for (const { run } of runs) domainByCompany.set(run.companyId, domains.get(run.id) ?? null);
    for (const row of sourceRows) {
      primaryById.set(
        row.id,
        isPrimarySource(row.finalUrl, domainByCompany.get(row.companyId) ?? null),
      );
      gradeById.set(row.id, row.evidenceGrade);
    }
  }
  const primaryCounts = new Map<string, number>();
  for (const row of factRows) {
    if (!row.runId) continue;
    const score = at(row.runId);
    score.facts += 1;
    if (isAgentMade(row.createdBy)) score.agent.facts += 1;
    if (isExtractorMade(row.createdBy)) score.extractor.facts += 1;
    if (isAgentMade(row.createdBy) || isExtractorMade(row.createdBy)) {
      bumpVerification(score, row.verification);
      bumpKindShare(score.verificationByKind, factValueKind(row), row.verification);
      bumpKindShare(score.verificationByGrade, itemGrade(gradeById, row.quoteSourceId, row.sourceIds), row.verification);
    }
    areaAt(row.runId, row.area).facts += 1;
    if (row.sourceIds.some((id) => primaryById.get(id))) {
      primaryCounts.set(row.runId, (primaryCounts.get(row.runId) ?? 0) + 1);
    }
  }
  for (const score of scores.values()) {
    score.primaryShare = score.facts === 0 ? null : round2((primaryCounts.get(score.runId) ?? 0) / score.facts);
  }

  const recordRows = await db
    .select({
      firstSeenRunId: records.firstSeenRunId,
      lastSeenRunId: records.lastSeenRunId,
      type: records.type,
      area: records.area,
      sourceIds: records.sourceIds,
      quoteSourceId: records.quoteSourceId,
      createdBy: records.createdBy,
      verification: records.verification,
    })
    .from(records)
    .where(or(inArray(records.firstSeenRunId, runIds), inArray(records.lastSeenRunId, runIds)));
  const recordCited = [...new Set(recordRows.flatMap((r) => r.sourceIds))].filter((id) => !gradeById.has(id));
  if (recordCited.length > 0) {
    const extraRows = await db
      .select({ id: sources.id, evidenceGrade: sources.evidenceGrade })
      .from(sources)
      .where(inArray(sources.id, recordCited));
    for (const row of extraRows) gradeById.set(row.id, row.evidenceGrade);
  }
  for (const row of recordRows) {
    const counted = new Set<string>();
    for (const runId of [row.firstSeenRunId, row.lastSeenRunId]) {
      if (!runId || !scores.has(runId) || counted.has(runId)) continue;
      counted.add(runId);
      bumpType(at(runId).recordsByType, row.type);
      if (isAgentMade(row.createdBy)) bumpType(at(runId).agent.recordsByType, row.type);
      if (isExtractorMade(row.createdBy)) bumpType(at(runId).extractor.recordsByType, row.type);
      if (isAgentMade(row.createdBy) || isExtractorMade(row.createdBy)) {
        bumpVerification(at(runId), row.verification);
        bumpKindShare(at(runId).verificationByRecordType, row.type, row.verification);
        bumpKindShare(at(runId).verificationByGrade, itemGrade(gradeById, row.quoteSourceId, row.sourceIds), row.verification);
      }
      bumpType(areaAt(runId, row.area).recordsByType, row.type);
    }
    if (row.type === "review" && row.firstSeenRunId && scores.has(row.firstSeenRunId)) {
      at(row.firstSeenRunId).reviewsIngested += 1;
      areaAt(row.firstSeenRunId, row.area).reviewsIngested += 1;
      if (isAgentMade(row.createdBy)) {
        at(row.firstSeenRunId).agent.reviewsIngested += 1;
      }
      if (isExtractorMade(row.createdBy)) {
        at(row.firstSeenRunId).extractor.reviewsIngested += 1;
      }
    }
  }

  const documentRows = await db
    .select({ runId: documents.runId, area: documents.area, createdBy: documents.createdBy })
    .from(documents)
    .where(inArray(documents.runId, runIds));
  for (const row of documentRows) {
    if (!row.runId) continue;
    at(row.runId).documents += 1;
    if (isAgentMade(row.createdBy)) at(row.runId).agent.documents += 1;
    if (isExtractorMade(row.createdBy)) at(row.runId).extractor.documents += 1;
    areaAt(row.runId, row.area).documents += 1;
  }

  const findingRows = await db
    .select({
      runId: findings.runId,
      area: findings.area,
      sourceIds: findings.sourceIds,
      factIds: findings.factIds,
      recordIds: findings.recordIds,
      createdBy: findings.createdBy,
    })
    .from(findings)
    .where(inArray(findings.runId, runIds));
  for (const row of findingRows) {
    if (!row.runId) continue;
    at(row.runId).findings += 1;
    if (isAgentMade(row.createdBy)) at(row.runId).agent.findings += 1;
    if (isExtractorMade(row.createdBy)) at(row.runId).extractor.findings += 1;
    areaAt(row.runId, row.area).findings += 1;
    if (row.sourceIds.length + row.factIds.length + row.recordIds.length >= 2) {
      at(row.runId).findingsWellCited += 1;
    }
  }

  const eventRows = await db
    .select({ runId: runEvents.runId, payload: runEvents.payload })
    .from(runEvents)
    .where(and(inArray(runEvents.runId, runIds), eq(runEvents.type, "mcp_call")));
  for (const row of eventRows) {
    at(row.runId).mcpCalls += 1;
    if ((row.payload as { status?: unknown }).status === "forbidden") at(row.runId).forbidden += 1;
  }

  const piiRows = await db
    .select({ runId: runEvents.runId, payload: runEvents.payload })
    .from(runEvents)
    .where(and(inArray(runEvents.runId, runIds), eq(runEvents.type, "log")));
  for (const row of piiRows) {
    const hits = (row.payload as { pii_redact?: { hits?: unknown } }).pii_redact?.hits;
    if (typeof hits === "number" && Number.isFinite(hits) && hits > 0) at(row.runId).piiRedactions += hits;
  }

  const statusRows = await db
    .select({ runId: areaStatuses.runId, area: areaStatuses.area, status: areaStatuses.status, reason: areaStatuses.reason })
    .from(areaStatuses)
    .where(inArray(areaStatuses.runId, runIds));
  for (const row of statusRows) {
    const cell = areaAt(row.runId, row.area);
    cell.status = row.status;
    cell.statusReason = row.reason;
  }

  const keyRows = await db
    .select({ key: factKeys.key, createdBy: factKeys.createdBy })
    .from(factKeys)
    .where(and(eq(factKeys.status, "provisional"), like(factKeys.createdBy, "agent:%")));
  for (const row of keyRows) {
    for (const runId of runIds) {
      if (row.createdBy.startsWith(`agent:${runId}/`)) at(runId).newProvisionalKeys.push(row.key);
    }
  }
  const typeRows = await db
    .select({ name: recordTypes.name, createdBy: recordTypes.createdBy })
    .from(recordTypes)
    .where(and(eq(recordTypes.status, "provisional"), like(recordTypes.createdBy, "agent:%")));
  for (const row of typeRows) {
    for (const runId of runIds) {
      if (row.createdBy.startsWith(`agent:${runId}/`)) at(runId).newProvisionalTypes.push(row.name);
    }
  }
  for (const score of scores.values()) {
    score.newProvisionalKeys.sort();
    score.newProvisionalTypes.sort();
  }

  const searchRows = await db
    .select({ id: webSearches.id, runId: webSearches.runId, area: webSearches.area })
    .from(webSearches)
    .where(inArray(webSearches.runId, runIds));
  const searchRun = new Map<string, string>();
  for (const row of searchRows) {
    searchRun.set(row.id, row.runId);
    const score = at(row.runId);
    score.searches.total += 1;
    const bucket = row.area ?? "unattributed";
    score.searches.byArea[bucket] = (score.searches.byArea[bucket] ?? 0) + 1;
  }
  if (searchRows.length > 0) {
    const linkedRows = await db
      .select({ webSearchId: sources.webSearchId })
      .from(sources)
      .where(inArray(sources.webSearchId, [...searchRun.keys()]));
    const hitByRun = new Map<string, Set<string>>();
    for (const row of linkedRows) {
      if (!row.webSearchId) continue;
      const runId = searchRun.get(row.webSearchId);
      if (!runId) continue;
      if (!hitByRun.has(runId)) hitByRun.set(runId, new Set());
      hitByRun.get(runId)?.add(row.webSearchId);
    }
    for (const score of scores.values()) {
      if (score.searches.total === 0) continue;
      score.searches.withCapturePct = round2((hitByRun.get(score.runId)?.size ?? 0) / score.searches.total);
    }
  }
  const fallbackRows = await db
    .select({ runId: sources.runId })
    .from(sources)
    .where(and(inArray(sources.runId, runIds), eq(sources.via, "muse_fetch")));
  for (const row of fallbackRows) at(row.runId).searches.museFetchFallbacks += 1;

  return assemble(scores);
}

// Rows with a null or unexpected area still count toward run totals.
function emptyAreaDetached(score: RunScore, name: string | null): AreaScore {
  if (name === null) {
    let general = (score.areas as Record<string, AreaScore>)["general"];
    if (!general) {
      general = emptyArea();
      (score.areas as Record<string, AreaScore>)["general"] = general;
    }
    return general;
  }
  let bucket = (score.areas as Record<string, AreaScore>)[name];
  if (!bucket) {
    bucket = emptyArea();
    (score.areas as Record<string, AreaScore>)[name] = bucket;
  }
  return bucket;
}

function assemble(scores: Map<string, RunScore>): ScorecardResult {
  const runs = [...scores.values()].sort((a, b) => (a.companyName ?? "").localeCompare(b.companyName ?? ""));
  const totals: BatchTotals = {
    runs: runs.length,
    facts: 0,
    recordsByType: {},
    reviewsIngested: 0,
    documents: 0,
    findings: 0,
    verification: emptyVerification(),
    verificationByKind: {},
    verificationByRecordType: {},
    verificationByGrade: {},
    searches: emptySearches(),
    agent: emptyAgent(),
    extractor: emptyAgent(),
    mcpCalls: 0,
    forbidden: 0,
    piiRedactions: 0,
    minutes: 0,
    runsWithUsage: 0,
    tokens: { input: 0, output: 0, cached: 0, reasoning: 0, calls: 0 },
    childrenIncluded: true,
  };
  for (const run of runs) {
    totals.facts += run.facts;
    for (const [type, n] of Object.entries(run.recordsByType)) {
      totals.recordsByType[type] = (totals.recordsByType[type] ?? 0) + n;
    }
    totals.reviewsIngested += run.reviewsIngested;
    totals.documents += run.documents;
    totals.findings += run.findings;
    totals.verification.verified += run.verification.verified;
    totals.verification.docOnly += run.verification.docOnly;
    totals.verification.mismatch += run.verification.mismatch;
    totals.verification.unverified += run.verification.unverified;
    totals.verification.verifiedValue += run.verification.verifiedValue;
    mergeKindShares(totals.verificationByKind, run.verificationByKind);
    mergeKindShares(totals.verificationByRecordType, run.verificationByRecordType);
    mergeKindShares(totals.verificationByGrade, run.verificationByGrade);
    totals.searches.total += run.searches.total;
    totals.searches.museFetchFallbacks += run.searches.museFetchFallbacks;
    for (const [areaName, n] of Object.entries(run.searches.byArea)) {
      totals.searches.byArea[areaName] = (totals.searches.byArea[areaName] ?? 0) + n;
    }
    totals.agent.facts += run.agent.facts;
    for (const [type, n] of Object.entries(run.agent.recordsByType)) {
      totals.agent.recordsByType[type] = (totals.agent.recordsByType[type] ?? 0) + n;
    }
    totals.agent.reviewsIngested += run.agent.reviewsIngested;
    totals.agent.documents += run.agent.documents;
    totals.agent.findings += run.agent.findings;
    totals.extractor.facts += run.extractor.facts;
    for (const [type, n] of Object.entries(run.extractor.recordsByType)) {
      totals.extractor.recordsByType[type] = (totals.extractor.recordsByType[type] ?? 0) + n;
    }
    totals.extractor.reviewsIngested += run.extractor.reviewsIngested;
    totals.extractor.documents += run.extractor.documents;
    totals.extractor.findings += run.extractor.findings;
    totals.mcpCalls += run.mcpCalls;
    totals.forbidden += run.forbidden;
    totals.piiRedactions += run.piiRedactions;
    if (run.minutes !== null) totals.minutes = round2(totals.minutes + run.minutes);
    if (run.tokens) {
      totals.runsWithUsage += 1;
      totals.tokens.input += run.tokens.input;
      totals.tokens.output += run.tokens.output;
      totals.tokens.cached += run.tokens.cached;
      totals.tokens.reasoning += run.tokens.reasoning;
      totals.tokens.calls += run.tokens.calls;
      if (!run.tokens.childrenIncluded) totals.childrenIncluded = false;
    }
  }
  if (totals.searches.total > 0) {
    const hits = runs.reduce(
      (sum, run) => sum + Math.round((run.searches.withCapturePct ?? 0) * run.searches.total),
      0,
    );
    totals.searches.withCapturePct = round2(hits / totals.searches.total);
  }
  return { runs, totals };
}
