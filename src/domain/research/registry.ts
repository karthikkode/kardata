import { eq, or, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  factKeys,
  facts,
  records,
  recordTypes,
  type Area,
  type FactKey,
  type RecordTypeRow,
} from "../../db/schema.js";
import { DomainError, isUniqueViolation } from "../errors.js";
import {
  FACT_KEY_PATTERN,
  RECORD_TYPE_PATTERN,
  isRecordFieldType,
  nearDuplicates,
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

export interface DescribeRegistryInput {
  name: string;
  description?: string;
  fields?: { name: string; type?: string; description?: string }[];
}

export interface DescribeRegistryResult {
  kind: "fact_key" | "record_type";
  warnings: string[];
}

// Add a description (and, for types, field details) to an auto-created entry.
export async function describeRegistryEntry(
  db: DbLike,
  input: DescribeRegistryInput,
): Promise<DescribeRegistryResult> {
  const [key] = await db.select().from(factKeys).where(eq(factKeys.key, input.name));
  const [type] = await db.select().from(recordTypes).where(eq(recordTypes.name, input.name));
  if (key && type) {
    throw new DomainError("invalid_input", `"${input.name}" is both a fact key and a record type`);
  }
  if (!key && !type) throw new DomainError("not_found", `no registry entry "${input.name}"`);
  if (key) {
    if (input.fields && input.fields.length > 0) {
      throw new DomainError("invalid_input", `fact key "${input.name}" takes no fields`);
    }
    if (input.description !== undefined) {
      await db.update(factKeys).set({ description: input.description }).where(eq(factKeys.key, key.key));
    }
    return { kind: "fact_key", warnings: [] };
  }
  const entry = type as RecordTypeRow;
  const warnings: string[] = [];
  if (input.description !== undefined) {
    await db.update(recordTypes).set({ description: input.description }).where(eq(recordTypes.name, entry.name));
  }
  if (input.fields && input.fields.length > 0) {
    const fields = [...entry.fields];
    for (const f of input.fields) {
      if (!f.name) throw new DomainError("invalid_input", "described fields need a name");
      if (f.type !== undefined && !isRecordFieldType(f.type)) {
        throw new DomainError("invalid_input", `field "${f.name}": unknown type "${f.type}"`);
      }
      const at = fields.findIndex((existing) => existing.name === f.name);
      if (at >= 0) {
        const current = fields[at] as { name: string; type: string; description: string };
        fields[at] = {
          name: current.name,
          type: f.type ?? current.type,
          description: f.description ?? current.description,
        };
      } else {
        fields.push({ name: f.name, type: f.type ?? "json", description: f.description ?? "" });
        if (!f.type) warnings.push(`field "${f.name}" added with type json`);
      }
    }
    await db.update(recordTypes).set({ fields }).where(eq(recordTypes.name, entry.name));
  }
  return { kind: "record_type", warnings };
}

export interface CurateRegistryInput {
  name: string;
  approve?: boolean;
  renameTo?: string;
  mergeInto?: string;
}

// Operator tidying of provisional names. Unlike writes, curation gates:
// renaming onto a near-duplicate is rejected.
export async function curateRegistryEntry(
  db: DbLike,
  input: CurateRegistryInput,
): Promise<FactKey | RecordTypeRow | { mergedInto: string }> {
  const ops = [input.approve, input.renameTo, input.mergeInto].filter(Boolean).length;
  if (ops === 0) throw new DomainError("invalid_input", "pass one of approve, rename_to, merge_into");
  if (ops > 1) throw new DomainError("invalid_input", "pass only one of approve, rename_to, merge_into");
  const [key] = await db.select().from(factKeys).where(eq(factKeys.key, input.name));
  const [type] = await db.select().from(recordTypes).where(eq(recordTypes.name, input.name));
  if (key && type) {
    throw new DomainError("invalid_input", `"${input.name}" is both a fact key and a record type`);
  }
  if (!key && !type) throw new DomainError("not_found", `no registry entry "${input.name}"`);
  if (key) return curateFactKey(db, key, input);
  return curateRecordType(db, type as RecordTypeRow, input);
}

function checkNearDuplicates(name: string, existing: string[]): void {
  const matches = nearDuplicates(name, existing);
  if (matches.length > 0) {
    throw new DomainError(
      "conflict",
      `"${name}" nearly duplicates: ${matches.join(", ")}. Merge into it instead.`,
    );
  }
}

async function curateFactKey(
  db: DbLike,
  entry: FactKey,
  input: CurateRegistryInput,
): Promise<FactKey | { mergedInto: string }> {
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

async function curateRecordType(
  db: DbLike,
  entry: RecordTypeRow,
  input: CurateRegistryInput,
): Promise<RecordTypeRow | { mergedInto: string }> {
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
          `merging "${entry.name}" into "${input.mergeInto}" would collide on a natural key`,
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
