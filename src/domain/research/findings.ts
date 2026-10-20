import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  area,
  companies,
  confidence,
  findings,
  findingStatus,
  facts,
  records,
  researchRuns,
  sources,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";

export interface AddFindingInput {
  companyId: string;
  runId?: string | null;
  area: string;
  claim: string;
  detail?: string | null;
  sourceIds: string[];
  factIds?: string[];
  recordIds?: string[];
  confidence: string;
  status: string;
  tags?: string[];
  createdBy: string;
}

async function checkOwned(
  db: DbLike,
  table: typeof sources | typeof facts | typeof records,
  label: string,
  ids: string[],
  companyId: string,
): Promise<void> {
  if (ids.length === 0) return;
  const found = await db
    .select({ id: table.id, companyId: table.companyId })
    .from(table)
    .where(inArray(table.id, ids));
  const byId = new Map(found.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw new DomainError("invalid_input", `unknown ${label} ${id}`);
    if (row.companyId !== companyId) {
      throw new DomainError("invalid_input", `${label} ${id} belongs to another company`);
    }
  }
}

export async function addFinding(db: DbLike, input: AddFindingInput): Promise<string> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  if (input.runId) {
    const [run] = await db
      .select({ id: researchRuns.id, companyId: researchRuns.companyId })
      .from(researchRuns)
      .where(eq(researchRuns.id, input.runId));
    if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
    if (run.companyId !== input.companyId) {
      throw new DomainError("invalid_input", `run ${input.runId} belongs to another company`);
    }
  }
  if (!area.enumValues.includes(input.area as (typeof area.enumValues)[number])) {
    throw new DomainError(
      "invalid_input",
      `unknown area "${input.area}". Valid areas: ${area.enumValues.join(", ")}`,
    );
  }
  if (input.claim.trim() === "") throw new DomainError("invalid_input", "finding needs a claim");
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length === 0) {
    throw new DomainError("invalid_input", "finding needs at least one source_id");
  }
  if (!confidence.enumValues.includes(input.confidence as (typeof confidence.enumValues)[number])) {
    throw new DomainError(
      "invalid_input",
      `confidence must be ${confidence.enumValues.join(", ")}`,
    );
  }
  if (!findingStatus.enumValues.includes(input.status as (typeof findingStatus.enumValues)[number])) {
    throw new DomainError("invalid_input", `status must be ${findingStatus.enumValues.join(", ")}`);
  }
  await checkOwned(db, sources, "source", [...new Set(input.sourceIds)], input.companyId);
  await checkOwned(db, facts, "fact", [...new Set(input.factIds ?? [])], input.companyId);
  await checkOwned(db, records, "record", [...new Set(input.recordIds ?? [])], input.companyId);
  if (input.tags !== undefined && (!Array.isArray(input.tags) || !input.tags.every((t) => typeof t === "string"))) {
    throw new DomainError("invalid_input", "tags must be an array of strings");
  }

  const [row] = await db
    .insert(findings)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      runId: input.runId ?? null,
      area: input.area as typeof findings.$inferInsert.area,
      claim: input.claim,
      detail: input.detail ?? null,
      sourceIds: [...new Set(input.sourceIds)],
      factIds: [...new Set(input.factIds ?? [])],
      recordIds: [...new Set(input.recordIds ?? [])],
      confidence: input.confidence as typeof findings.$inferInsert.confidence,
      status: input.status as typeof findings.$inferInsert.status,
      tags: input.tags ?? [],
      createdBy: input.createdBy,
    })
    .returning({ id: findings.id });
  if (!row) throw new Error("finding insert returned no row");
  return row.id;
}
