import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db, DbLike } from "../db/client.js";
import { area, companies, researchRuns, type ResearchRun } from "../db/schema.js";
import { DomainError, isUniqueViolation } from "../domain/errors.js";

export const COLLECT_BATCH_MAX = 100;

export type StartCollectEntry =
  | { companyId: string; runId: string; status: "queued" }
  | { companyId: string; runId: string; status: "already_running" };

export interface StartCollectResult {
  batchId: string;
  runs: StartCollectEntry[];
}

export interface StartCollectLink {
  companyJobId: string;
  stage: NonNullable<ResearchRun["stage"]>;
}

export async function startCollect(
  db: Db,
  companyIds: string[],
  areas?: string[],
  link?: StartCollectLink,
  adapters?: string[],
): Promise<StartCollectResult> {
  if (companyIds.length === 0) throw new DomainError("invalid_input", "at least one company id is required");
  if (companyIds.length > COLLECT_BATCH_MAX) {
    throw new DomainError("invalid_input", `at most ${COLLECT_BATCH_MAX} companies per batch`);
  }
  const unique = [...new Set(companyIds)];
  if (areas !== undefined) {
    const names = area.enumValues as readonly string[];
    for (const a of areas) {
      if (!names.includes(a)) {
        throw new DomainError("invalid_input", `unknown area "${a}". Valid areas: ${names.join(", ")}`);
      }
    }
  }
  if (adapters !== undefined) {
    // Deferred: a static import cycles (adapters -> collectors -> domain -> queue).
    const { ADAPTERS } = await import("../collect/adapters.js");
    const ids = ADAPTERS.map((a) => a.id);
    for (const a of adapters) {
      if (!ids.includes(a)) {
        throw new DomainError("invalid_input", `unknown adapter "${a}". Valid adapters: ${ids.join(", ")}`);
      }
    }
  }
  const found = await db
    .select({ id: companies.id })
    .from(companies)
    .where(inArray(companies.id, unique));
  const missing = unique.filter((id) => !found.some((f) => f.id === id));
  if (missing.length > 0) {
    throw new DomainError("invalid_input", `unknown companies: ${missing.join(", ")}`);
  }

  const batchId = randomUUID();
  const runs: StartCollectEntry[] = [];
  for (const companyId of unique) {
    try {
      const [row] = await db
        .insert(researchRuns)
        .values({
          id: randomUUID(),
          companyId,
          kind: "collect",
          status: "queued",
          requestedAreas: (areas ?? null) as ResearchRun["requestedAreas"],
          requestedAdapters: adapters ?? null,
          batchId,
          companyJobId: link?.companyJobId ?? null,
          stage: link?.stage ?? null,
        })
        .returning({ id: researchRuns.id });
      if (!row) throw new Error("run insert returned no row");
      runs.push({ companyId, runId: row.id, status: "queued" });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [active] = await db
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(
          and(eq(researchRuns.companyId, companyId), sql`${researchRuns.status} IN ('queued', 'running')`),
        );
      if (!active) throw new Error("unique violation but no active run found");
      runs.push({ companyId, runId: active.id, status: "already_running" });
    }
  }
  return { batchId, runs };
}

// Operator writes (imports, owner tools) share one manual run per company per
// UTC day. It is born succeeded, so it never holds the one-active-run slot and
// the runner never touches it. (Stage 3 gives agents real runs of their own;
// until then nothing creates kind='agent' runs.)
export async function getOrCreateManualRun(db: DbLike, companyId: string): Promise<string> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [existing] = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.companyId, companyId),
        eq(researchRuns.kind, "manual"),
        gte(researchRuns.createdAt, dayStart),
      ),
    )
    .orderBy(asc(researchRuns.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const now = new Date();
  const [row] = await db
    .insert(researchRuns)
    .values({
      id: randomUUID(),
      companyId,
      kind: "manual",
      status: "succeeded",
      createdBy: "owner",
      startedAt: now,
      finishedAt: now,
    })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("run insert returned no row");
  return row.id;
}

export async function cancelRun(db: Db, runId: string): Promise<ResearchRun> {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new DomainError("not_found", `run not found: ${runId}`);
  if (run.status !== "queued" && run.status !== "running") return run;
  const [updated] = await db
    .update(researchRuns)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(researchRuns.id, runId))
    .returning();
  if (!updated) throw new Error("cancel update returned no row");
  return updated;
}
