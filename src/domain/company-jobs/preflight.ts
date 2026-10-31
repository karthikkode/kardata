import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { area, preflightReports, researchRuns, type PreflightReport } from "../../db/schema.js";
import { DomainError } from "../errors.js";

/** PreflightReportV1: the collect plan an agent files per company. */

const KNOWN_AREAS = area.enumValues as readonly string[];

const reviewLocation = z.object({
  platform: z.string().min(1).max(120),
  url: z.string().url().nullable(),
  evidence: z.string().min(1).max(2000),
});

const adapterNeed = z.object({
  adapterId: z.string().min(1).max(80),
  reason: z.string().min(1).max(2000),
});

const missingSource = z.object({
  suggestedId: z.string().min(1).max(80),
  reason: z.string().min(1).max(2000),
  evidenceUrls: z.array(z.string().url()).max(10),
});

export const preflightReportSchema = z.object({
  version: z.literal(1),
  reviewLocations: z.array(reviewLocation).max(30),
  adaptersRequired: z.array(adapterNeed).max(30),
  adaptersMissing: z.array(missingSource).max(30),
  collectDirectives: z.object({
    areas: z.array(z.string()).max(20),
    notes: z.string().max(4000),
  }),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(4000),
});

export type PreflightReportV1 = z.infer<typeof preflightReportSchema>;

function parseReport(report: unknown): PreflightReportV1 {
  // Agents sometimes stringify the report; accept that too.
  let value = report;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new DomainError("invalid_input", "invalid preflight report: not an object or JSON string");
    }
  }
  const parsed = preflightReportSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    throw new DomainError("invalid_input", `invalid preflight report: ${where}${first?.message ?? "rejected"}`);
  }
  for (const name of parsed.data.collectDirectives.areas) {
    if (!KNOWN_AREAS.includes(name)) {
      throw new DomainError(
        "invalid_input",
        `invalid preflight report: unknown area "${name}" (want: ${KNOWN_AREAS.join(", ")})`,
      );
    }
  }
  return parsed.data;
}

export interface SavePreflightReportInput {
  jobId: string;
  companyId: string;
  report: unknown;
}

/** Validate and file a new report version for the job. */
export async function savePreflightReport(db: Db, input: SavePreflightReportInput): Promise<PreflightReport> {
  const data = parseReport(input.report);
  const [latest] = await db
    .select({ reportVersion: preflightReports.reportVersion })
    .from(preflightReports)
    .where(eq(preflightReports.jobId, input.jobId))
    .orderBy(desc(preflightReports.reportVersion))
    .limit(1);
  const [row] = await db
    .insert(preflightReports)
    .values({
      id: randomUUID(),
      jobId: input.jobId,
      companyId: input.companyId,
      reportVersion: (latest?.reportVersion ?? 0) + 1,
      report: data as Record<string, unknown>,
    })
    .returning();
  if (!row) throw new Error("preflight report insert returned no row");
  return row;
}

/** File a report for a subjob run (thin-wrapper entry: resolves the job from the run). */
export async function savePreflightReportForRun(
  db: Db,
  runId: string,
  report: unknown,
): Promise<PreflightReport> {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new DomainError("not_found", `run not found: ${runId}`);
  if (!run.companyJobId) throw new DomainError("invalid_input", "run is not a company-job subjob");
  return savePreflightReport(db, { jobId: run.companyJobId, companyId: run.companyId, report });
}

/** Latest filed report, or null when the agent has not filed one yet. */
export async function getPreflightReport(db: Db, jobId: string): Promise<PreflightReport | null> {
  const [row] = await db
    .select()
    .from(preflightReports)
    .where(eq(preflightReports.jobId, jobId))
    .orderBy(desc(preflightReports.reportVersion))
    .limit(1);
  return row ?? null;
}

export type PreflightGate = { ok: true; report: PreflightReportV1 } | { ok: false; reason: string };

/** Fixed RIA collect plan (Stage 5.7 follow-up): no LLM preflight for ria jobs. */
export const RIA_COLLECT_ADAPTERS = ["sec_firm", "site", "jobs", "news"] as const;
export const RIA_COLLECT_AREAS = ["financials", "decisions", "product", "business_model", "hiring", "other"] as const;

export function riaPreflightReport(): PreflightReportV1 {
  return {
    version: 1,
    reviewLocations: [],
    adaptersRequired: RIA_COLLECT_ADAPTERS.map((adapterId) => ({
      adapterId,
      reason: "fixed RIA plan: SEC filing first, then site, jobs and news",
    })),
    adaptersMissing: [],
    collectDirectives: {
      areas: [...RIA_COLLECT_AREAS],
      notes: "SEC data is the primary source; a failed homepage is recorded, never fatal.",
    },
    confidence: 1,
    notes: "Fixed RIA plan (no LLM).",
  };
}

/** Latest filed report version + confidence for status views; null when missing or unparsable. */
export async function getPreflightSummary(db: Db, jobId: string): Promise<{ version: number; confidence: number } | null> {
  const row = await getPreflightReport(db, jobId);
  if (!row) return null;
  try {
    const parsed = parseReport(row.report);
    return { version: row.reportVersion, confidence: parsed.confidence };
  } catch {
    return null;
  }
}

/**
 * The collect gate: preflight is done only with a valid filed report.
 * Anything else fails the preflight subjob (retry path, never a skip).
 */
export async function checkPreflightGate(db: Db, jobId: string): Promise<PreflightGate> {
  const row = await getPreflightReport(db, jobId);
  if (!row) return { ok: false, reason: "no preflight report saved" };
  try {
    return { ok: true, report: parseReport(row.report) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof DomainError ? err.message : "latest preflight report is invalid",
    };
  }
}

