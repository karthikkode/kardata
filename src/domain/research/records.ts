import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  companies,
  records,
  recordTypes,
  researchRuns,
  sources,
  type RecordTypeRow,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { validateTypedValue } from "./validate.js";

export interface UpsertRecordItem {
  type: string;
  data: Record<string, unknown>;
  sourceIds: string[];
}

export interface UpsertRecordsInput {
  companyId: string;
  runId?: string | null;
  createdBy: string;
  records: UpsertRecordItem[];
}

export type UpsertRecordResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; error: string };

// At most 50 review excerpts per company per platform (spec cap).
const REVIEW_EXCERPT_CAP = 50;

export async function upsertRecords(
  db: DbLike,
  input: UpsertRecordsInput,
): Promise<UpsertRecordResult[]> {
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
  const byType = new Map(types.map((t) => [t.name, t]));
  const validTypes = types.map((t) => t.name).sort().join(", ");

  const cited = [...new Set(input.records.flatMap((r) => r.sourceIds ?? []))];
  const found =
    cited.length > 0
      ? await db
          .select({ id: sources.id, companyId: sources.companyId })
          .from(sources)
          .where(inArray(sources.id, cited))
      : [];
  const bySource = new Map(found.map((s) => [s.id, s]));

  const results: UpsertRecordResult[] = [];
  for (const item of input.records) {
    try {
      results.push(await upsertOne(db, input, item, byType, validTypes, bySource));
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

async function upsertOne(
  db: DbLike,
  input: UpsertRecordsInput,
  item: UpsertRecordItem,
  byType: Map<string, RecordTypeRow>,
  validTypes: string,
  bySource: Map<string, { id: string; companyId: string }>,
): Promise<{ ok: true; id: string; created: boolean }> {
  const def = byType.get(item.type);
  if (!def) {
    throw new DomainError("invalid_input", `unknown record type "${item.type}". Valid types: ${validTypes}`);
  }
  if (typeof item.data !== "object" || item.data === null || Array.isArray(item.data)) {
    throw new DomainError("invalid_input", `record "${item.type}": data must be an object`);
  }
  const fields = new Map(def.fields.map((f) => [f.name, f]));
  const validFields = def.fields.map((f) => f.name).join(", ");
  for (const name of Object.keys(item.data)) {
    if (name !== "text_hash" && !fields.has(name)) {
      throw new DomainError(
        "invalid_input",
        `record "${item.type}": unknown field "${name}". Valid fields: ${validFields}`,
      );
    }
  }
  if ("text_hash" in item.data) {
    throw new DomainError("invalid_input", `record "${item.type}": text_hash is server-computed; omit it`);
  }
  const data: Record<string, unknown> = {};
  for (const field of def.fields) {
    const value = item.data[field.name];
    if (value === undefined || value === null) {
      if (field.required) {
        throw new DomainError("invalid_input", `record "${item.type}": missing required field "${field.name}"`);
      }
      continue;
    }
    // Type-check only; the value itself is stored.
    validateTypedValue(field.type, value, `record "${item.type}" field "${field.name}"`);
    data[field.name] = value;
  }
  // Server-computed natural-key component for review excerpts.
  if (def.naturalKey.includes("text_hash")) {
    const text = data["text"];
    if (typeof text !== "string" || text === "") {
      throw new DomainError("invalid_input", `record "${item.type}": text is required for text_hash`);
    }
    data["text_hash"] = createHash("sha256").update(text).digest("hex");
  }
  const keyParts: Record<string, unknown> = {};
  for (const name of [...def.naturalKey].sort()) {
    const value = data[name];
    if (value === undefined || value === null || value === "") {
      throw new DomainError(
        "invalid_input",
        `record "${item.type}": natural key field "${name}" is missing`,
      );
    }
    keyParts[name] = value;
  }
  const naturalKeyHash = createHash("sha256").update(JSON.stringify(keyParts)).digest("hex");

  if (!Array.isArray(item.sourceIds) || item.sourceIds.length === 0) {
    throw new DomainError("invalid_input", `record "${item.type}" needs at least one source_id`);
  }
  for (const id of item.sourceIds) {
    const source = bySource.get(id);
    if (!source) throw new DomainError("invalid_input", `record "${item.type}": unknown source ${id}`);
    if (source.companyId !== input.companyId) {
      throw new DomainError(
        "invalid_input",
        `record "${item.type}": source ${id} belongs to another company`,
      );
    }
  }

  const [existing] = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.companyId, input.companyId),
        eq(records.type, def.name),
        eq(records.naturalKeyHash, naturalKeyHash),
      ),
    );
  if (existing) {
    const merged = { ...existing.data, ...data };
    const union = [...new Set([...existing.sourceIds, ...item.sourceIds])];
    const [updated] = await db
      .update(records)
      .set({
        data: merged,
        sourceIds: union,
        lastSeenRunId: input.runId ?? existing.lastSeenRunId,
        updatedAt: new Date(),
      })
      .where(eq(records.id, existing.id))
      .returning({ id: records.id });
    if (!updated) throw new Error("record update returned no row");
    return { ok: true, id: updated.id, created: false };
  }

  if (def.name === "review_excerpt") {
    const platform = data["platform"];
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(records)
      .where(
        and(
          eq(records.companyId, input.companyId),
          eq(records.type, "review_excerpt"),
          sql`${records.data}->>'platform' = ${platform}`,
        ),
      );
    if ((count ?? 0) >= REVIEW_EXCERPT_CAP) {
      throw new DomainError(
        "invalid_input",
        `at most ${REVIEW_EXCERPT_CAP} review excerpts per company per platform`,
      );
    }
  }

  const [row] = await db
    .insert(records)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      type: def.name,
      area: def.area,
      naturalKeyHash,
      data,
      sourceIds: [...new Set(item.sourceIds)],
      firstSeenRunId: input.runId ?? null,
      lastSeenRunId: input.runId ?? null,
      createdBy: input.createdBy,
    })
    .returning({ id: records.id });
  if (!row) throw new Error("record insert returned no row");
  return { ok: true, id: row.id, created: true };
}
