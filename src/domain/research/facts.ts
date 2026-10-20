import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  area,
  companies,
  factKeys,
  facts,
  researchRuns,
  sources,
  type FactKey,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";
import {
  inferValueType,
  isValidDateString,
  nearDuplicates,
  sanitizeFactKey,
  sanitizeQualifierName,
  validateTypedValue,
  type TypedValue,
} from "./validate.js";

export const FACT_BATCH_MAX = 200;

export interface AddFactItem {
  key: string;
  value: unknown;
  qualifiers?: Record<string, unknown>;
  asOf?: string | null;
  sourceIds: string[];
  confidence?: string;
  note?: string | null;
  tags?: string[];
}

export interface AddFactsInput {
  companyId: string;
  runId?: string | null;
  createdBy: string;
  facts: AddFactItem[];
  // Collectors pass strict: unknown keys and mistyped values are bugs there,
  // so they fail fast instead of auto-creating or widening.
  strict?: boolean;
}

export type AddFactResult =
  | { ok: true; id: string; warnings: string[] }
  | { ok: false; error: string };

interface FactWriteContext {
  input: AddFactsInput;
  byKey: Map<string, FactKey>;
  allKeys: string[];
  bySource: Map<string, { id: string; companyId: string }>;
}

export async function addFacts(db: DbLike, input: AddFactsInput): Promise<AddFactResult[]> {
  if (input.facts.length > FACT_BATCH_MAX) {
    throw new DomainError("invalid_input", `at most ${FACT_BATCH_MAX} facts per call`);
  }
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
  const ctx: FactWriteContext = {
    input,
    byKey: new Map(keys.map((k) => [k.key, k])),
    allKeys: keys.map((k) => k.key),
    bySource: new Map(),
  };

  const cited = [...new Set(input.facts.flatMap((f) => f.sourceIds ?? []))];
  if (cited.length > 0) {
    const found = await db
      .select({ id: sources.id, companyId: sources.companyId })
      .from(sources)
      .where(inArray(sources.id, cited));
    ctx.bySource = new Map(found.map((s) => [s.id, s]));
  }

  const results: AddFactResult[] = [];
  for (const item of input.facts) {
    try {
      results.push(await insertFact(db, ctx, item));
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

async function insertFact(
  db: DbLike,
  ctx: FactWriteContext,
  item: AddFactItem,
): Promise<{ ok: true; id: string; warnings: string[] }> {
  const warnings: string[] = [];
  const strict = ctx.input.strict === true;

  const key = sanitizeFactKey(item.key);
  if (!key) throw new DomainError("invalid_input", `unusable fact key "${item.key}"`);
  if (key !== item.key) {
    if (strict) throw new DomainError("invalid_input", `fact key "${item.key}" is not dotted snake_case`);
    warnings.push(`key "${item.key}" sanitized to "${key}"`);
  }
  const found = ctx.byKey.get(key);
  if (!found && strict) {
    const valid = ctx.allKeys.sort().join(", ");
    throw new DomainError("invalid_input", `unknown fact key "${key}". Valid keys: ${valid}`);
  }
  let def: FactKey = found ?? (await autoCreateKey(db, ctx, key, item, warnings));

  const qualifiers = normalizeQualifiers(item.qualifiers ?? {}, key);
  const knownQualifiers = def.qualifierNames;
  const newQualifiers = Object.keys(qualifiers).filter((q) => !knownQualifiers.includes(q));
  if (newQualifiers.length > 0) {
    if (strict) {
      const valid = knownQualifiers.length > 0 ? knownQualifiers.join(", ") : "(this key takes no qualifiers)";
      throw new DomainError("invalid_input", `fact "${key}": unknown qualifier "${newQualifiers[0]}". Valid qualifiers: ${valid}`);
    }
    const names = [...knownQualifiers, ...newQualifiers];
    await db.update(factKeys).set({ qualifierNames: names }).where(eq(factKeys.key, def.key));
    def = { ...def, qualifierNames: names };
    ctx.byKey.set(def.key, def);
    warnings.push(`new qualifier(s) ${newQualifiers.join(", ")} added to "${key}"`);
  }

  let typed: TypedValue;
  if (def.status === "approved") {
    try {
      typed = validateTypedValue(def.valueType, item.value, `fact "${key}"`);
    } catch (err) {
      throw new DomainError(
        "invalid_input",
        `${err instanceof Error ? err.message : String(err)} (approved key "${key}" takes ${def.valueType})`,
      );
    }
  } else if (strict) {
    typed = validateTypedValue(def.valueType, item.value, `fact "${key}"`);
  } else {
    try {
      typed = validateTypedValue(def.valueType, item.value, `fact "${key}"`);
    } catch {
      const widened = typeof item.value === "string" && item.value.trim() !== "" ? "text" : "json";
      const from = def.valueType;
      await db.update(factKeys).set({ valueType: widened }).where(eq(factKeys.key, def.key));
      def = { ...def, valueType: widened };
      ctx.byKey.set(def.key, def);
      warnings.push(`key "${key}" widened from ${from} to ${widened} to fit the value`);
      typed = validateTypedValue(widened, item.value, `fact "${key}"`);
    }
  }

  let asOf: string | null = null;
  if (item.asOf !== undefined && item.asOf !== null) {
    if (isValidDateString(item.asOf)) asOf = item.asOf;
    else warnings.push(`as_of "${item.asOf}" is not YYYY-MM-DD; stored without as_of`);
  }

  if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
    throw new DomainError("invalid_input", `fact "${key}" needs at least one source_id`);
  }
  for (const id of item.sourceIds) {
    const source = ctx.bySource.get(id);
    if (!source) throw new DomainError("invalid_input", `fact "${key}": unknown source ${id}`);
    if (source.companyId !== ctx.input.companyId) {
      throw new DomainError("invalid_input", `fact "${key}": source ${id} belongs to another company`);
    }
  }

  let confidence: "low" | "medium" | "high" = "medium";
  if (item.confidence !== undefined) {
    if (item.confidence === "low" || item.confidence === "medium" || item.confidence === "high") {
      confidence = item.confidence;
    } else {
      warnings.push(`confidence "${item.confidence}" is not low/medium/high; stored as medium`);
    }
  }

  let tags: string[] = [];
  if (item.tags !== undefined) {
    if (Array.isArray(item.tags) && item.tags.every((t) => typeof t === "string")) tags = item.tags;
    else warnings.push("tags must be an array of strings; stored without tags");
  }

  const [row] = await db
    .insert(facts)
    .values({
      id: randomUUID(),
      companyId: ctx.input.companyId,
      runId: ctx.input.runId ?? null,
      key: def.key,
      area: def.area,
      valueNum: typed.valueNum,
      valueText: typed.valueText,
      valueDate: typed.valueDate,
      valueBool: typed.valueBool,
      valueJson: typed.valueJson ?? undefined,
      currency: typed.currency,
      unit: def.unit,
      qualifiers,
      asOf,
      sourceIds: [...new Set(item.sourceIds)],
      confidence,
      note: item.note ?? null,
      tags,
      createdBy: ctx.input.createdBy,
    })
    .returning({ id: facts.id });
  if (!row) throw new Error("fact insert returned no row");

  await db
    .update(factKeys)
    .set({
      useCount: sql`${factKeys.useCount} + 1`,
      firstUsedAt: sql`COALESCE(${factKeys.firstUsedAt}, now())`,
    })
    .where(eq(factKeys.key, def.key));
  return { ok: true, id: row.id, warnings };
}

async function autoCreateKey(
  db: DbLike,
  ctx: FactWriteContext,
  key: string,
  item: AddFactItem,
  warnings: string[],
): Promise<FactKey> {
  const valueType = inferValueType(item.value);
  const first = key.split(".")[0] ?? "";
  const knownAreas = (area.enumValues as readonly string[]).filter((a) => a !== "other");
  const keyArea = knownAreas.includes(first) ? first : null;
  const qualifierNames = Object.keys(item.qualifiers ?? {})
    .map((q) => sanitizeQualifierName(q))
    .filter((q): q is string => q !== null);
  const [created] = await db
    .insert(factKeys)
    .values({
      key,
      area: keyArea as FactKey["area"],
      valueType,
      unit: null,
      description: `Auto-created for "${key}"`,
      qualifierNames: [...new Set(qualifierNames)],
      status: "provisional",
      createdBy: ctx.input.createdBy,
    })
    .returning();
  if (!created) throw new Error("fact key insert returned no row");
  ctx.byKey.set(key, created);
  ctx.allKeys.push(key);
  warnings.push(`created provisional key "${key}" (type ${valueType})`);
  const matches = nearDuplicates(key, ctx.allKeys);
  if (matches.length > 0) {
    warnings.push(`"${key}" nearly duplicates existing: ${matches.join(", ")} — reuse it if you meant the same thing`);
  }
  return created;
}

function normalizeQualifiers(input: Record<string, unknown>, key: string): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new DomainError("invalid_input", `fact "${key}": qualifiers must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input)) {
    const name = sanitizeQualifierName(rawName);
    if (!name) throw new DomainError("invalid_input", `fact "${key}": unusable qualifier "${rawName}"`);
    if (typeof value === "string") out[name] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[name] = String(value);
    else throw new DomainError("invalid_input", `fact "${key}": qualifier "${rawName}" must be a string`);
  }
  return out;
}
