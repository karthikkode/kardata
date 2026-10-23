import { and, eq, exists, gt, inArray, not, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  areaStatuses,
  companies,
  companyJobs,
  factsCurrent,
  records,
  researchRuns,
} from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { startCollect } from "../runs/queue.js";

/**
 * reviews_onsite backfill: re-collects on-site reviews for completed
 * Shopify companies whose run skipped onsite (pre-fix plan ordering ran it
 * before the review-app fact existed). Deterministic only: enqueue goes
 * through the standard collect queue (onsite adapter alone, no research,
 * no extraction) and the runner's collect_concurrency knob paces the work.
 */

export const BACKFILL_ADAPTER = "reviews_onsite";

/** reviews.app values (lowercased) the backfill collects. */
export const BACKFILL_SUPPORTED_APPS = new Set(["judge.me", "judgeme", "yotpo", "okendo", "stamped", "loox"]);

export const BACKFILL_DEFAULT_LIMIT = 25;
export const BACKFILL_MAX_LIMIT = 100;
const ONSITE_CREATED_BY = "collector:reviews_onsite";

export type BackfillStatus = "done" | "blocked" | "no_products" | "parse_failed" | "skipped" | "pending";

export interface BackfillEnqueueEntry {
  companyId: string;
  companyName: string;
  app: string;
  runId: string;
}

export interface BackfillEnqueueResult {
  batchId: string | null;
  scanned: number;
  queued: BackfillEnqueueEntry[];
  alreadyRunning: BackfillEnqueueEntry[];
  /** Current reviews.app values outside the backfill set, with company counts. */
  unsupportedApps: { app: string; companies: number }[];
  /** Pass back as cursor for the next batch; null when done. */
  nextCursor: string | null;
}

export interface BackfillCompanyStatus {
  companyId: string;
  companyName: string;
  app: string | null;
  runId: string;
  runStatus: string;
  status: BackfillStatus;
  ingested: number;
  reason: string;
}

export interface BackfillStatusResult {
  batchId: string;
  counts: Record<string, number>;
  ingestedReviews: number;
  results: BackfillCompanyStatus[];
  stillNone: { blocked: number; no_products: number; parse_failed: number };
}

export interface BackfillEnqueueOptions {
  limit?: number;
  cursor?: string | null;
}

function completedJob(db: Db, companyIdCol: typeof companies.id) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(companyJobs)
      .where(and(eq(companyJobs.companyId, companyIdCol), eq(companyJobs.status, "completed"))),
  );
}

function hasProducts(db: Db, companyIdCol: typeof companies.id) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(records)
      .where(and(eq(records.companyId, companyIdCol), eq(records.type, "product"))),
  );
}

function hasOnsiteReviews(db: Db, companyIdCol: typeof companies.id) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(records)
      .where(
        and(
          eq(records.companyId, companyIdCol),
          eq(records.type, "review"),
          eq(records.createdBy, ONSITE_CREATED_BY),
        ),
      ),
  );
}

async function candidateIds(db: Db, limit: number, cursor: string | null): Promise<{ id: string; name: string | null }[]> {
  const where = and(
    completedJob(db, companies.id),
    hasProducts(db, companies.id),
    not(hasOnsiteReviews(db, companies.id)),
    cursor ? gt(companies.id, cursor) : undefined,
  );
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(where)
    .orderBy(companies.id)
    .limit(limit);
}

async function currentApps(db: Db, companyIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (companyIds.length === 0) return map;
  const rows = await db
    .select({ companyId: factsCurrent.companyId, valueText: factsCurrent.valueText })
    .from(factsCurrent)
    .where(and(inArray(factsCurrent.companyId, companyIds), eq(factsCurrent.key, "reviews.app")));
  for (const row of rows) {
    // reviews.app is a comma-joined list ("Yotpo,Loox"); split before matching.
    const parts = (row.valueText ?? "").split(",").map((p) => p.trim()).filter((p) => p !== "");
    if (parts.length === 0) continue;
    const list = map.get(row.companyId) ?? [];
    for (const value of parts) {
      if (!list.includes(value)) list.push(value);
    }
    map.set(row.companyId, list);
  }
  return map;
}

/** Current reviews.app histogram over completed Shopify companies. */
async function unsupportedHistogram(db: Db): Promise<{ app: string; companies: number }[]> {
  const shopifyCompleted = db
    .select({ id: companies.id })
    .from(companies)
    .where(and(completedJob(db, companies.id), hasProducts(db, companies.id)));
  // reviews.app values are comma-joined ("Yotpo,Loox"); split into one row per app.
  const split = db
    .select({
      companyId: factsCurrent.companyId,
      app: sql<string>`lower(trim(unnest(string_to_array(${factsCurrent.valueText}, ','))))`.as("app"),
    })
    .from(factsCurrent)
    .where(
      and(
        eq(factsCurrent.key, "reviews.app"),
        sql`${factsCurrent.valueText} is not null`,
        inArray(factsCurrent.companyId, shopifyCompleted),
      ),
    )
    .as("split_apps");
  const rows = await db
    .select({ app: split.app, companies: sql<number>`count(distinct ${split.companyId})` })
    .from(split)
    .where(sql`${split.app} <> ''`)
    .groupBy(split.app);
  return rows
    .filter((r) => !BACKFILL_SUPPORTED_APPS.has(r.app))
    .map((r) => ({ app: r.app, companies: Number(r.companies) }))
    .sort((a, b) => b.companies - a.companies);
}

export async function enqueueReviewsOnsiteBackfill(
  db: Db,
  opts: BackfillEnqueueOptions = {},
): Promise<BackfillEnqueueResult> {
  const limit = Math.min(Math.max(opts.limit ?? BACKFILL_DEFAULT_LIMIT, 1), BACKFILL_MAX_LIMIT);
  const cursor = opts.cursor ?? null;

  const scanned = await candidateIds(db, limit, cursor);
  const apps = await currentApps(
    db,
    scanned.map((c) => c.id),
  );
  const todo: { companyId: string; companyName: string; app: string }[] = [];
  for (const company of scanned) {
    const values = apps.get(company.id) ?? [];
    const supported = values.find((v) => BACKFILL_SUPPORTED_APPS.has(v.toLowerCase()));
    if (supported) todo.push({ companyId: company.id, companyName: company.name ?? "Unnamed company", app: supported });
  }

  const queued: BackfillEnqueueEntry[] = [];
  const alreadyRunning: BackfillEnqueueEntry[] = [];
  let batchId: string | null = null;
  if (todo.length > 0) {
    // Standard queue path: the runner claims these at collect_concurrency.
    const batch = await startCollect(
      db,
      todo.map((t) => t.companyId),
      ["reviews"],
      undefined,
      [BACKFILL_ADAPTER],
    );
    batchId = batch.batchId;
    const byId = new Map(todo.map((t) => [t.companyId, t]));
    for (const entry of batch.runs) {
      const meta = byId.get(entry.companyId);
      if (!meta) continue;
      const out = { ...meta, runId: entry.runId };
      if (entry.status === "queued") queued.push(out);
      else alreadyRunning.push(out);
    }
  }

  const histogram = await unsupportedHistogram(db);
  const lastScanned = scanned.length === 0 ? null : scanned[scanned.length - 1]?.id ?? null;
  return {
    batchId,
    scanned: scanned.length,
    queued,
    alreadyRunning,
    unsupportedApps: histogram,
    nextCursor: scanned.length < limit ? null : lastScanned,
  };
}

function classifyFinished(
  runStatus: string,
  runError: string | null,
  area: { status: string; reason: string | null } | undefined,
): { status: BackfillStatus; reason: string } {
  if (runStatus === "failed" || runStatus === "cancelled" || runStatus === "stalled") {
    return { status: "parse_failed", reason: (runError ?? area?.reason ?? runStatus).slice(0, 200) };
  }
  if (!area) return { status: "parse_failed", reason: "no outcome recorded" };
  const reason = (area.reason ?? area.status).slice(0, 200);
  if (area.status === "done") return { status: "done", reason };
  if (area.status === "blocked") return { status: "blocked", reason };
  if (area.status === "skipped") {
    return reason.includes("not a Shopify store") ? { status: "no_products", reason } : { status: "skipped", reason };
  }
  if (reason.includes("no product pages")) return { status: "no_products", reason };
  return { status: "parse_failed", reason };
}

export async function backfillBatchStatus(db: Db, batchId: string): Promise<BackfillStatusResult> {
  const runs = await db
    .select({
      runId: researchRuns.id,
      companyId: researchRuns.companyId,
      companyName: companies.name,
      status: researchRuns.status,
      error: researchRuns.error,
    })
    .from(researchRuns)
    .innerJoin(companies, eq(researchRuns.companyId, companies.id))
    .where(eq(researchRuns.batchId, batchId))
    .orderBy(companies.name);
  if (runs.length === 0) throw new DomainError("not_found", `batch not found: ${batchId}`);

  const runIds = runs.map((r) => r.runId);
  const areas = await db
    .select({ runId: areaStatuses.runId, status: areaStatuses.status, reason: areaStatuses.reason })
    .from(areaStatuses)
    .where(and(inArray(areaStatuses.runId, runIds), eq(areaStatuses.area, "reviews")));
  const areaByRun = new Map(areas.map((a) => [a.runId, a]));
  const ingestedRows = await db
    .select({ runId: records.firstSeenRunId, n: sql<number>`count(*)` })
    .from(records)
    .where(
      and(
        eq(records.type, "review"),
        eq(records.createdBy, ONSITE_CREATED_BY),
        inArray(records.firstSeenRunId, runIds),
      ),
    )
    .groupBy(records.firstSeenRunId);
  const ingestedByRun = new Map<string, number>();
  for (const row of ingestedRows) {
    if (row.runId) ingestedByRun.set(row.runId, Number(row.n));
  }
  const apps = await currentApps(
    db,
    runs.map((r) => r.companyId),
  );

  const counts: Record<string, number> = {};
  const results: BackfillCompanyStatus[] = [];
  const stillNone = { blocked: 0, no_products: 0, parse_failed: 0 };
  let ingestedReviews = 0;
  for (const run of runs) {
    counts[run.status] = (counts[run.status] ?? 0) + 1;
    const ingested = ingestedByRun.get(run.runId) ?? 0;
    ingestedReviews += ingested;
    const values = apps.get(run.companyId) ?? [];
    const app = values.find((v) => BACKFILL_SUPPORTED_APPS.has(v.toLowerCase())) ?? values[0] ?? null;
    if (run.status === "queued" || run.status === "running") {
      results.push({
        companyId: run.companyId,
        companyName: run.companyName ?? "Unnamed company",
        app,
        runId: run.runId,
        runStatus: run.status,
        status: "pending",
        ingested,
        reason: run.status,
      });
      continue;
    }
    const classified = classifyFinished(run.status, run.error, areaByRun.get(run.runId) ?? undefined);
    if (classified.status === "blocked") stillNone.blocked += 1;
    if (classified.status === "no_products") stillNone.no_products += 1;
    if (classified.status === "parse_failed") stillNone.parse_failed += 1;
    results.push({
      companyId: run.companyId,
      companyName: run.companyName ?? "Unnamed company",
      app,
      runId: run.runId,
      runStatus: run.status,
      status: classified.status,
      ingested,
      reason: classified.reason,
    });
  }
  return { batchId, counts, ingestedReviews, results, stillNone };
}
