import { eq, or, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  factKeys,
  facts,
  records,
  recordTypes,
  type Area,
  type FactKey,
  type RecordField,
  type RecordTypeRow,
} from "../../db/schema.js";
import { DomainError, isUniqueViolation } from "../errors.js";
import {
  FACT_KEY_PATTERN,
  RECORD_TYPE_PATTERN,
  SNAKE_PATTERN,
  isFactValueType,
  isRecordFieldType,
  levenshtein,
  normalizeRegistryName,
} from "./validate.js";

export interface Registry {
  factKeys: FactKey[];
  recordTypes: RecordTypeRow[];
}

// General (null-area) entries apply everywhere, so an area filter keeps them.
export async function listRegistry(db: DbLike, area?: Area): Promise<Registry> {
  const keys = area
    ? await db
        .select()
        .from(factKeys)
        .where(or(eq(factKeys.area, area), sql`${factKeys.area} IS NULL`))
        .orderBy(factKeys.key)
    : await db.select().from(factKeys).orderBy(factKeys.key);
  const types = area
    ? await db
        .select()
        .from(recordTypes)
        .where(or(eq(recordTypes.area, area), sql`${recordTypes.area} IS NULL`))
        .orderBy(recordTypes.name)
    : await db.select().from(recordTypes).orderBy(recordTypes.name);
  return { factKeys: keys, recordTypes: types };
}

function checkNearDuplicates(name: string, existing: string[], kind: string): void {
  const norm = normalizeRegistryName(name);
  const matches = existing.filter((e) => {
    const other = normalizeRegistryName(e);
    return other === norm || levenshtein(norm, other) <= 2;
  });
  if (matches.length > 0) {
    throw new DomainError(
      "conflict",
      `"${name}" is already registered or nearly duplicates: ${matches.join(", ")}. Use the existing ${kind} instead.`,
    );
  }
}

export interface RegisterFactKeyInput {
  key: string;
  area?: Area | null;
  valueType: string;
  unit?: string | null;
  description: string;
  qualifierNames?: string[];
}

export async function registerFactKey(
  db: DbLike,
  input: RegisterFactKeyInput,
  createdBy: string,
): Promise<FactKey> {
  if (!FACT_KEY_PATTERN.test(input.key)) {
    throw new DomainError(
      "invalid_input",
      `fact key "${input.key}" must be snake_case segments joined by dots, e.g. "reviews.avg_rating"`,
    );
  }
  if (!isFactValueType(input.valueType)) {
    throw new DomainError(
      "invalid_input",
      `unknown value type "${input.valueType}" for key "${input.key}"`,
    );
  }
  if (!input.description || input.description.trim() === "") {
    throw new DomainError("invalid_input", `fact key "${input.key}" needs a one-line description`);
  }
  const qualifierNames = input.qualifierNames ?? [];
  for (const q of qualifierNames) {
    if (!SNAKE_PATTERN.test(q)) {
      throw new DomainError("invalid_input", `qualifier "${q}" must be snake_case`);
    }
  }
  if (new Set(qualifierNames).size !== qualifierNames.length) {
    throw new DomainError("invalid_input", `qualifier names must be unique`);
  }
  const existing = await db.select({ key: factKeys.key }).from(factKeys);
  checkNearDuplicates(
    input.key,
    existing.map((e) => e.key),
    "fact key",
  );
  try {
    const [row] = await db
      .insert(factKeys)
      .values({
        key: input.key,
        area: input.area ?? null,
        valueType: input.valueType,
        unit: input.unit ?? null,
        description: input.description.trim(),
        qualifierNames,
        status: "provisional",
        createdBy,
      })
      .returning();
    if (!row) throw new Error("fact key insert returned no row");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError("conflict", `fact key "${input.key}" is already registered`);
    }
    throw err;
  }
}

export interface RegisterRecordTypeInput {
  name: string;
  area?: Area | null;
  description: string;
  fields: RecordField[];
  naturalKey: string[];
}

export async function registerRecordType(
  db: DbLike,
  input: RegisterRecordTypeInput,
  createdBy: string,
): Promise<RecordTypeRow> {
  if (!RECORD_TYPE_PATTERN.test(input.name)) {
    throw new DomainError(
      "invalid_input",
      `record type "${input.name}" must be snake_case, e.g. "job_posting"`,
    );
  }
  if (!input.description || input.description.trim() === "") {
    throw new DomainError("invalid_input", `record type "${input.name}" needs a description`);
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    throw new DomainError("invalid_input", `record type "${input.name}" needs at least one field`);
  }
  const fieldNames = new Set<string>();
  for (const field of input.fields) {
    if (!field || typeof field !== "object") {
      throw new DomainError("invalid_input", `record type "${input.name}" has an invalid field`);
    }
    if (!SNAKE_PATTERN.test(field.name ?? "")) {
      throw new DomainError("invalid_input", `field "${field.name}" must be snake_case`);
    }
    if (fieldNames.has(field.name)) {
      throw new DomainError("invalid_input", `record type "${input.name}" repeats field "${field.name}"`);
    }
    fieldNames.add(field.name);
    if (!isRecordFieldType(field.type ?? "")) {
      throw new DomainError(
        "invalid_input",
        `field "${field.name}": unknown type "${field.type}"`,
      );
    }
    if (typeof field.required !== "boolean") {
      throw new DomainError("invalid_input", `field "${field.name}": "required" must be true or false`);
    }
    if (!field.description || field.description.trim() === "") {
      throw new DomainError("invalid_input", `field "${field.name}" needs a description`);
    }
  }
  if (!Array.isArray(input.naturalKey) || input.naturalKey.length === 0) {
    throw new DomainError("invalid_input", `record type "${input.name}" needs a non-empty natural key`);
  }
  for (const nk of input.naturalKey) {
    // text_hash is server-computed (see review_excerpt); it needs no field.
    if (nk !== "text_hash" && !fieldNames.has(nk)) {
      throw new DomainError(
        "invalid_input",
        `natural key "${nk}" is not a field of record type "${input.name}". Fields: ${[...fieldNames].join(", ")}`,
      );
    }
  }
  const existing = await db.select({ name: recordTypes.name }).from(recordTypes);
  checkNearDuplicates(
    input.name,
    existing.map((e) => e.name),
    "record type",
  );
  try {
    const [row] = await db
      .insert(recordTypes)
      .values({
        name: input.name,
        area: input.area ?? null,
        description: input.description.trim(),
        fields: input.fields,
        naturalKey: input.naturalKey,
        status: "provisional",
        createdBy,
      })
      .returning();
    if (!row) throw new Error("record type insert returned no row");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError("conflict", `record type "${input.name}" is already registered`);
    }
    throw err;
  }
}

export interface ApproveRegistryInput {
  kind: "fact_key" | "record_type";
  name: string;
  renameTo?: string;
  mergeInto?: string;
}

export async function approveRegistryEntry(
  db: DbLike,
  input: ApproveRegistryInput,
): Promise<FactKey | RecordTypeRow | { mergedInto: string }> {
  if (input.renameTo && input.mergeInto) {
    throw new DomainError("invalid_input", "pass only one of rename_to, merge_into");
  }
  if (input.kind === "fact_key") {
    const [entry] = await db.select().from(factKeys).where(eq(factKeys.key, input.name));
    if (!entry) throw new DomainError("not_found", `no fact key "${input.name}"`);
    if (input.mergeInto) {
      const [target] = await db.select().from(factKeys).where(eq(factKeys.key, input.mergeInto));
      if (!target) throw new DomainError("not_found", `no fact key "${input.mergeInto}"`);
      await db
        .update(facts)
        .set({ key: target.key, area: target.area })
        .where(eq(facts.key, entry.key));
      await db.delete(factKeys).where(eq(factKeys.key, entry.key));
      return { mergedInto: target.key };
    }
    if (input.renameTo) {
      if (!FACT_KEY_PATTERN.test(input.renameTo)) {
        throw new DomainError("invalid_input", `fact key "${input.renameTo}" must be snake_case segments joined by dots`);
      }
      const existing = await db.select({ key: factKeys.key }).from(factKeys);
      checkNearDuplicates(
        input.renameTo,
        existing.map((e) => e.key).filter((k) => k !== entry.key),
        "fact key",
      );
      const [renamed] = await db
        .update(factKeys)
        .set({ key: input.renameTo, status: "approved" })
        .where(eq(factKeys.key, entry.key))
        .returning();
      if (!renamed) throw new Error("fact key rename returned no row");
      return renamed;
    }
    const [approved] = await db
      .update(factKeys)
      .set({ status: "approved" })
      .where(eq(factKeys.key, entry.key))
      .returning();
    if (!approved) throw new Error("fact key approve returned no row");
    return approved;
  }
  const [entry] = await db.select().from(recordTypes).where(eq(recordTypes.name, input.name));
  if (!entry) throw new DomainError("not_found", `no record type "${input.name}"`);
  if (input.mergeInto) {
    const [target] = await db.select().from(recordTypes).where(eq(recordTypes.name, input.mergeInto));
    if (!target) throw new DomainError("not_found", `no record type "${input.mergeInto}"`);
    try {
      await db
        .update(records)
        .set({ type: target.name, area: target.area })
        .where(eq(records.type, entry.name));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "conflict",
          `merging "${input.name}" into "${input.mergeInto}" would collide on a natural key`,
        );
      }
      throw err;
    }
    await db.delete(recordTypes).where(eq(recordTypes.name, entry.name));
    return { mergedInto: target.name };
  }
  if (input.renameTo) {
    if (!RECORD_TYPE_PATTERN.test(input.renameTo)) {
      throw new DomainError("invalid_input", `record type "${input.renameTo}" must be snake_case`);
    }
    const existing = await db.select({ name: recordTypes.name }).from(recordTypes);
    checkNearDuplicates(
      input.renameTo,
      existing.map((e) => e.name).filter((n) => n !== entry.name),
      "record type",
    );
    const [renamed] = await db
      .update(recordTypes)
      .set({ name: input.renameTo, status: "approved" })
      .where(eq(recordTypes.name, entry.name))
      .returning();
    if (!renamed) throw new Error("record type rename returned no row");
    return renamed;
  }
  const [approved] = await db
    .update(recordTypes)
    .set({ status: "approved" })
    .where(eq(recordTypes.name, entry.name))
    .returning();
  if (!approved) throw new Error("record type approve returned no row");
  return approved;
}
