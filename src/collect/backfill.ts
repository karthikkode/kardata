import { randomUUID } from "node:crypto";
import { and, eq, exists, gt, inArray, not, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  companies,
  companyJobs,
  factsCurrent,
  records,
  researchRuns,
} from "../db/schema.js";
import { isUniqueViolation } from "../domain/errors.js";
import { getAdapter } from "./adapters.js";
import { executeCollectRun } from "./run.js";

/**
 * reviews_onsite backfill: re-collects on-site reviews for completed
 * Shopify companies whose run skipped onsite (pre-fix plan ordering ran it
 * before the review-app fact existed). Deterministic only: one onsite
 * adapter per company, no research, no extraction.
 */

/** reviews.app values (lowercased) the backfill collects. */
export const BACKFILL_SUPPORTED_APPS = new Set(["judge.me", "judgeme", "yotpo", "okendo", "stamped", "loox"]);

export const BACKFILL_DEFAULT_LIMIT = 25;
export const BACKFILL_MAX_LIMIT = 100;
const BACKFILL_CONCURRENCY = 5;
const ONSITE_CREATED_BY = "collector:reviews_onsite";

export type BackfillStatus = "done" | "blocked" | "no_products" | "parse_failed" | "skipped";

export interface BackfillCompanyResult {
  companyId: string;
  companyName: string;
  app: string | null;
  status: BackfillStatus;
  ingested: number;
  reason: string;
}

export interface BackfillResult {
  scanned: number;
  attempted: number;
  ingestedReviews: number;
  results: BackfillCompanyResult[];
  stillNone: { blocked: number; no_products: number; parse_failed: number };
  /** Current reviews.app values outside the backfill set, with company counts. */
  unsupportedApps: { app: string; companies: number }[];
  /** Pass back as cursor for the next batch; null when done. */
  nextCursor: string | null;
}

export interface BackfillOptions {
  limit?: number;
  cursor?: string | null;
  /** Test seam: replaces the real per-company collect run. */
  executeOne?: (companyId: string) => Promise<{ status: BackfillStatus; ingested: number; reason: string }>;
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

function classifyOutcome(outcome: { status: string; reason?: string } | undefined): {
  status: BackfillStatus;
  reason: string;
} {
  if (!outcome) return { status: "parse_failed", reason: "no outcome recorded" };
  const reason = outcome.reason ?? outcome.status;
  if (outcome.status === "done") return { status: "done", reason };
  if (outcome.status === "blocked") return { status: "blocked", reason };
  if (outcome.status === "skipped") return { status: "skipped", reason };
  if (reason.includes("no product pages")) return { status: "no_products", reason };
  return { status: "parse_failed", reason };
}

/** Real per-company run: onsite adapter alone in its own collect run. */
async function executeOnsiteAlone(db: Db, companyId: string): Promise<{ status: BackfillStatus; ingested: number; reason: string }> {
  const onsite = getAdapter("reviews_onsite");
  if (!onsite) throw new Error("reviews_onsite adapter missing");
  const runId = randomUUID();
  try {
    await db.insert(researchRuns).values({
      id: runId,
      companyId,
      kind: "collect",
      status: "running",
      startedAt: new Date(),
      companyJobId: null,
      stage: "collect",
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { status: "skipped", ingested: 0, reason: "live run in progress for this company" };
    }
    throw err;
  }
  // Inserted running: the shared engine only claims queued rows, so this
  // run is ours alone (and reaped if we ever stall past 10 minutes).
  const result = await executeCollectRun(db, runId, { adapters: [onsite] });
  const classified = classifyOutcome(result.outcomes.find((o) => o.area === "reviews") ?? result.outcomes[0]);
  let ingested = 0;
  if (classified.status === "done") {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(records)
      .where(
        and(
          eq(records.companyId, companyId),
          eq(records.type, "review"),
          eq(records.createdBy, ONSITE_CREATED_BY),
          eq(records.firstSeenRunId, runId),
        ),
      );
    ingested = Number(row?.n ?? 0);
  }
  return { ...classified, ingested };
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

export async function backfillReviewsOnsite(db: Db, opts: BackfillOptions = {}): Promise<BackfillResult> {
  const limit = Math.min(Math.max(opts.limit ?? BACKFILL_DEFAULT_LIMIT, 1), BACKFILL_MAX_LIMIT);
  const cursor = opts.cursor ?? null;
  const execute = opts.executeOne ?? ((companyId: string) => executeOnsiteAlone(db, companyId));

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

  const results: BackfillCompanyResult[] = [];
  const stillNone = { blocked: 0, no_products: 0, parse_failed: 0 };
  let ingestedReviews = 0;
  // Small pool: fetcher politeness is per-host (global), docker jobs run alone.
  for (let i = 0; i < todo.length; i += BACKFILL_CONCURRENCY) {
    const chunk = todo.slice(i, i + BACKFILL_CONCURRENCY);
    const settled = await Promise.all(
      chunk.map(async (company) => {
        try {
          const outcome = await execute(company.companyId);
          return { company, outcome };
        } catch (err) {
          return {
            company,
            outcome: {
              status: "parse_failed" as const,
              ingested: 0,
              reason: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
            },
          };
        }
      }),
    );
    for (const { company, outcome } of settled) {
      ingestedReviews += outcome.ingested;
      if (outcome.status === "blocked") stillNone.blocked += 1;
      if (outcome.status === "no_products") stillNone.no_products += 1;
      if (outcome.status === "parse_failed") stillNone.parse_failed += 1;
      results.push({
        companyId: company.companyId,
        companyName: company.companyName,
        app: company.app,
        status: outcome.status,
        ingested: outcome.ingested,
        reason: outcome.reason,
      });
    }
  }
  results.sort((a, b) => (a.companyId < b.companyId ? -1 : 1));

  const histogram = await unsupportedHistogram(db);
  const lastScanned = scanned.length === 0 ? null : scanned[scanned.length - 1]?.id ?? null;
  return {
    scanned: scanned.length,
    attempted: todo.length,
    ingestedReviews,
    results,
    stillNone,
    unsupportedApps: histogram,
    nextCursor: scanned.length < limit ? null : lastScanned,
  };
}
