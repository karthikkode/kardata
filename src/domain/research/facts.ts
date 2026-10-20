import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  companies,
  factKeys,
  facts,
  researchRuns,
  sources,
  type FactKey,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { isValidDateString, validateTypedValue } from "./validate.js";

export interface AddFactItem {
  key: string;
  value: unknown;
  qualifiers?: Record<string, string>;
  asOf?: string | null;
  sourceIds: string[];
  confidence: string;
  supersedesId?: string | null;
}

export interface AddFactsInput {
  companyId: string;
  runId?: string | null;
  createdBy: string;
  facts: AddFactItem[];
}

export type AddFactResult = { ok: true; id: string } | { ok: false; error: string };

export async function addFacts(db: DbLike, input: AddFactsInput): Promise<AddFactResult[]> {
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
  const keys = await db.select().from(factKeys);
  const byKey = new Map(keys.map((k) => [k.key, k]));
  const validKeys = keys.map((k) => k.key).sort().join(", ");

  // One lookup for every cited source id; results are checked per item.
  const cited = [...new Set(input.facts.flatMap((f) => f.sourceIds ?? []))];
  const found =
    cited.length > 0
      ? await db
          .select({ id: sources.id, companyId: sources.companyId })
          .from(sources)
          .where(inArray(sources.id, cited))
      : [];
  const bySource = new Map(found.map((s) => [s.id, s]));

  const results: AddFactResult[] = [];
  for (const item of input.facts) {
    try {
      results.push({ ok: true, id: await insertFact(db, input, item, byKey, validKeys, bySource) });
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

async function insertFact(
  db: DbLike,
  input: AddFactsInput,
  item: AddFactItem,
  byKey: Map<string, FactKey>,
  validKeys: string,
  bySource: Map<string, { id: string; companyId: string }>,
): Promise<string> {
  const def = byKey.get(item.key);
  if (!def) {
    throw new DomainError("invalid_input", `unknown fact key "${item.key}". Valid keys: ${validKeys}`);
  }
  const typed = validateTypedValue(def.valueType, item.value, `fact "${item.key}"`);
  const qualifiers = item.qualifiers ?? {};
  if (typeof qualifiers !== "object" || qualifiers === null || Array.isArray(qualifiers)) {
    throw new DomainError("invalid_input", `fact "${item.key}": qualifiers must be an object`);
  }
  for (const [name, value] of Object.entries(qualifiers)) {
    if (!def.qualifierNames.includes(name)) {
      const valid =
        def.qualifierNames.length > 0 ? def.qualifierNames.join(", ") : "(this key takes no qualifiers)";
      throw new DomainError(
        "invalid_input",
        `fact "${item.key}": unknown qualifier "${name}". Valid qualifiers: ${valid}`,
      );
    }
    if (typeof value !== "string" || value === "") {
      throw new DomainError("invalid_input", `fact "${item.key}": qualifier "${name}" must be a string`);
    }
  }
  if (item.asOf !== undefined && item.asOf !== null && !isValidDateString(item.asOf)) {
    throw new DomainError("invalid_input", `fact "${item.key}": as_of must be "YYYY-MM-DD"`);
  }
  if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
    throw new DomainError("invalid_input", `fact "${item.key}" needs at least one source_id`);
  }
  for (const id of item.sourceIds) {
    const source = bySource.get(id);
    if (!source) throw new DomainError("invalid_input", `fact "${item.key}": unknown source ${id}`);
    if (source.companyId !== input.companyId) {
      throw new DomainError("invalid_input", `fact "${item.key}": source ${id} belongs to another company`);
    }
  }
  if (item.confidence !== "low" && item.confidence !== "medium" && item.confidence !== "high") {
    throw new DomainError(
      "invalid_input",
      `fact "${item.key}": confidence must be low, medium or high`,
    );
  }
  if (item.supersedesId) {
    const [prev] = await db.select({ id: facts.id }).from(facts).where(eq(facts.id, item.supersedesId));
    if (!prev) throw new DomainError("invalid_input", `fact "${item.key}": unknown supersedes_id`);
  }
  const [row] = await db
    .insert(facts)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      runId: input.runId ?? null,
      key: def.key,
      area: def.area,
      valueNum: typed.valueNum,
      valueText: typed.valueText,
      valueDate: typed.valueDate,
      valueBool: typed.valueBool,
      valueJson: typed.valueJson ?? undefined,
      currency: typed.currency,
      qualifiers,
      asOf: item.asOf ?? null,
      sourceIds: [...new Set(item.sourceIds)],
      confidence: item.confidence,
      createdBy: input.createdBy,
      supersedesId: item.supersedesId ?? null,
    })
    .returning({ id: facts.id });
  if (!row) throw new Error("fact insert returned no row");
  return row.id;
}
