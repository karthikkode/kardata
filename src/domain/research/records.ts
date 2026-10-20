import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  companies,
  records,
  recordTypes,
  researchRuns,
  sources,
  type RecordField,
  type RecordTypeRow,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";
import {
  inferValueType,
  nearDuplicates,
  sanitizeTypeName,
  validateTypedValue,
} from "./validate.js";

export const RECORD_BATCH_MAX = 500;

export interface UpsertRecordItem {
  type: string;
  data: Record<string, unknown>;
  sourceIds: string[];
  naturalKey?: string[];
  tags?: string[];
  // Internal: exact natural-key values, when they differ from the stored data
  // (reviews_ingest hashes normalized text but stores the original).
  keyValues?: Record<string, unknown>;
}

export interface UpsertRecordsInput {
  companyId: string;
  runId?: string | null;
  createdBy: string;
  records: UpsertRecordItem[];
  strict?: boolean;
}

export type UpsertRecordResult =
  | { ok: true; id: string; outcome: "created" | "updated" | "unchanged"; warnings: string[] }
  | { ok: false; error: string };

interface RecordWriteContext {
  input: UpsertRecordsInput;
  byType: Map<string, RecordTypeRow>;
  allTypes: string[];
  bySource: Map<string, { id: string; companyId: string }>;
}

export async function upsertRecords(
  db: DbLike,
  input: UpsertRecordsInput,
): Promise<UpsertRecordResult[]> {
  if (input.records.length > RECORD_BATCH_MAX) {
    throw new DomainError("invalid_input", `at most ${RECORD_BATCH_MAX} records per call`);
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
  const types = await db.select().from(recordTypes);
  const ctx: RecordWriteContext = {
    input,
    byType: new Map(types.map((t) => [t.name, t])),
    allTypes: types.map((t) => t.name),
    bySource: new Map(),
  };

  const cited = [...new Set(input.records.flatMap((r) => r.sourceIds ?? []))];
  if (cited.length > 0) {
    const found = await db
      .select({ id: sources.id, companyId: sources.companyId })
      .from(sources)
      .where(inArray(sources.id, cited));
    ctx.bySource = new Map(found.map((s) => [s.id, s]));
  }

  const results: UpsertRecordResult[] = [];
  for (const item of input.records) {
    try {
      results.push(await upsertOne(db, ctx, item));
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

async function upsertOne(
  db: DbLike,
  ctx: RecordWriteContext,
  item: UpsertRecordItem,
): Promise<{ ok: true; id: string; outcome: "created" | "updated" | "unchanged"; warnings: string[] }> {
  const warnings: string[] = [];
  const strict = ctx.input.strict === true;

  const typeName = sanitizeTypeName(item.type);
  if (!typeName) throw new DomainError("invalid_input", `unusable record type "${item.type}"`);
  if (typeName !== item.type) {
    if (strict) throw new DomainError("invalid_input", `record type "${item.type}" is not snake_case`);
    warnings.push(`type "${item.type}" sanitized to "${typeName}"`);
  }
  if (typeof item.data !== "object" || item.data === null || Array.isArray(item.data)) {
    throw new DomainError("invalid_input", `record "${typeName}": data must be an object`);
  }
  if (Object.keys(item.data).length === 0) {
    throw new DomainError("invalid_input", `record "${typeName}": data is empty`);
  }

  let def = ctx.byType.get(typeName);
  if (!def) {
    if (strict) {
      const valid = ctx.allTypes.sort().join(", ");
      throw new DomainError("invalid_input", `unknown record type "${typeName}". Valid types: ${valid}`);
    }
    def = await autoCreateType(db, ctx, typeName, item, warnings);
  }

  // Known fields are type-checked; unknown ones are kept (and added to the type).
  const fields = new Map(def.fields.map((f) => [f.name, f]));
  const added: RecordField[] = [];
  const data: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(item.data)) {
    const field = fields.get(name);
    if (!field) {
      if (strict) {
        const valid = def.fields.map((f) => f.name).join(", ");
        throw new DomainError("invalid_input", `record "${typeName}": unknown field "${name}". Valid fields: ${valid}`);
      }
      added.push({ name, type: inferValueType(value), description: "Auto-created field" });
      data[name] = value;
      continue;
    }
    if (value === undefined || value === null) continue;
    try {
      validateTypedValue(field.type, value, `record "${typeName}" field "${name}"`);
      data[name] = value;
    } catch {
      if (strict) {
        validateTypedValue(field.type, value, `record "${typeName}" field "${name}"`);
      }
      warnings.push(`field "${name}" kept as given (expected ${field.type})`);
      data[name] = value;
    }
  }
  if (added.length > 0) {
    const merged = [...def.fields, ...added];
    await db.update(recordTypes).set({ fields: merged }).where(eq(recordTypes.name, def.name));
    def = { ...def, fields: merged };
    ctx.byType.set(def.name, def);
    warnings.push(`added field(s) ${added.map((f) => f.name).join(", ")} to "${typeName}"`);
  }

  const naturalKey = resolveNaturalKey(def, item);
  const keySource = item.keyValues ?? data;
  const keyParts: Record<string, unknown> = {};
  for (const name of [...naturalKey].sort()) {
    const value = keySource[name] ?? data[name];
    if (value === undefined || value === null || value === "") {
      throw new DomainError("invalid_input", `record "${typeName}": natural key field "${name}" is missing`);
    }
    keyParts[name] = value;
  }
  const naturalKeyHash = createHash("sha256").update(JSON.stringify(keyParts)).digest("hex");

  if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
    throw new DomainError("invalid_input", `record "${typeName}" needs at least one source_id`);
  }
  for (const id of item.sourceIds) {
    const source = ctx.bySource.get(id);
    if (!source) throw new DomainError("invalid_input", `record "${typeName}": unknown source ${id}`);
    if (source.companyId !== ctx.input.companyId) {
      throw new DomainError("invalid_input", `record "${typeName}": source ${id} belongs to another company`);
    }
  }

  let tags: string[] = [];
  if (item.tags !== undefined) {
    if (Array.isArray(item.tags) && item.tags.every((t) => typeof t === "string")) tags = item.tags;
    else warnings.push("tags must be an array of strings; stored without tags");
  }

  const [existing] = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.companyId, ctx.input.companyId),
        eq(records.type, def.name),
        eq(records.naturalKeyHash, naturalKeyHash),
      ),
    );
  await bumpUseCount(db, def.name);

  if (!existing) {
    const [row] = await db
      .insert(records)
      .values({
        id: randomUUID(),
        companyId: ctx.input.companyId,
        type: def.name,
        area: def.area,
        naturalKeyHash,
        data,
        sourceIds: [...new Set(item.sourceIds)],
        tags,
        firstSeenRunId: ctx.input.runId ?? null,
        lastSeenRunId: ctx.input.runId ?? null,
        createdBy: ctx.input.createdBy,
      })
      .returning({ id: records.id });
    if (!row) throw new Error("record insert returned no row");
    return { ok: true, id: row.id, outcome: "created", warnings };
  }

  const merged = { ...existing.data, ...data };
  const union = [...new Set([...existing.sourceIds, ...item.sourceIds])];
  const tagsUnion = [...new Set([...existing.tags, ...tags])];
  if (
    JSON.stringify(merged) === JSON.stringify(existing.data) &&
    union.length === existing.sourceIds.length &&
    tagsUnion.length === existing.tags.length
  ) {
    return { ok: true, id: existing.id, outcome: "unchanged", warnings };
  }
  const [updated] = await db
    .update(records)
    .set({
      data: merged,
      sourceIds: union,
      tags: tagsUnion,
      lastSeenRunId: ctx.input.runId ?? existing.lastSeenRunId,
      updatedAt: new Date(),
    })
    .where(eq(records.id, existing.id))
    .returning({ id: records.id });
  if (!updated) throw new Error("record update returned no row");
  return { ok: true, id: updated.id, outcome: "updated", warnings };
}

async function autoCreateType(
  db: DbLike,
  ctx: RecordWriteContext,
  typeName: string,
  item: UpsertRecordItem,
  warnings: string[],
): Promise<RecordTypeRow> {
  const fields: RecordField[] = Object.entries(item.data).map(([name, value]) => ({
    name,
    type: inferValueType(value),
    description: "Auto-created field",
  }));
  const naturalKey = resolveNaturalKey(
    { naturalKey: item.naturalKey ?? [] } as RecordTypeRow,
    item,
    true,
  );
  const [created] = await db
    .insert(recordTypes)
    .values({
      name: typeName,
      area: null,
      description: `Auto-created for "${typeName}"`,
      fields,
      naturalKey,
      status: "provisional",
      createdBy: ctx.input.createdBy,
    })
    .returning();
  if (!created) throw new Error("record type insert returned no row");
  ctx.byType.set(typeName, created);
  ctx.allTypes.push(typeName);
  warnings.push(`created provisional record type "${typeName}"`);
  const matches = nearDuplicates(typeName, ctx.allTypes);
  if (matches.length > 0) {
    warnings.push(
      `"${typeName}" nearly duplicates existing: ${matches.join(", ")} — reuse it if you meant the same thing`,
    );
  }
  return created;
}

// A per-item natural_key overrides the type's. The default is `url` when the
// data has one, else a hash of all fields.
function resolveNaturalKey(
  def: Pick<RecordTypeRow, "naturalKey">,
  item: UpsertRecordItem,
  creating = false,
): string[] {
  if (item.naturalKey && item.naturalKey.length > 0) {
    const usable = item.naturalKey.filter((n) => {
      const v = (item.keyValues ?? item.data)[n] ?? item.data[n];
      return v !== undefined && v !== null && v !== "";
    });
    if (usable.length === 0) {
      throw new DomainError("invalid_input", `record "${item.type}": no usable natural key field`);
    }
    return usable;
  }
  if (!creating && def.naturalKey.length > 0) return def.naturalKey;
  if ("url" in item.data && item.data["url"] !== "" && item.data["url"] !== undefined) return ["url"];
  return Object.keys(item.data).sort();
}

async function bumpUseCount(db: DbLike, name: string): Promise<void> {
  await db
    .update(recordTypes)
    .set({ useCount: sql`${recordTypes.useCount} + 1` })
    .where(eq(recordTypes.name, name));
}
