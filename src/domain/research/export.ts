import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  companies,
  documents,
  factKeys,
  facts,
  records,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: unknown[]): string {
  return `${cells.map(csvCell).join(",")}\n`;
}

function safeSegments(path: string): string[] | null {
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments;
}

export interface ExportResult {
  dir: string;
  documents: number;
  facts: number;
  records: Record<string, number>;
  skipped: string[];
}

export async function exportCompany(db: Db, companyId: string): Promise<ExportResult> {
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${companyId}`);

  const slug = `${(company.name ?? "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company"}-${company.id.slice(0, 8)}`;
  const dir = join("var", "exports", slug);
  await mkdir(dir, { recursive: true });
  const skipped: string[] = [];

  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.isCurrent, true)))
    .orderBy(documents.path);
  let documentCount = 0;
  for (const doc of docs) {
    if (!doc.path) {
      skipped.push(doc.id);
      continue;
    }
    const segments = safeSegments(doc.path);
    if (!segments) {
      skipped.push(doc.path);
      continue;
    }
    const file = join(dir, ...segments);
    await mkdir(join(dir, ...segments.slice(0, -1)), { recursive: true });
    await writeFile(file, doc.contentMd, "utf8");
    documentCount += 1;
  }

  const factRows = await db
    .selectDistinctOn([facts.companyId, facts.key, facts.qualifiers], {
      key: facts.key,
      area: facts.area,
      valueType: factKeys.valueType,
      valueNum: facts.valueNum,
      valueText: facts.valueText,
      valueDate: facts.valueDate,
      valueBool: facts.valueBool,
      valueJson: facts.valueJson,
      currency: facts.currency,
      unit: facts.unit,
      qualifiers: facts.qualifiers,
      asOf: facts.asOf,
      confidence: facts.confidence,
      note: facts.note,
      tags: facts.tags,
      sourceIds: facts.sourceIds,
      createdBy: facts.createdBy,
      createdAt: facts.createdAt,
    })
    .from(facts)
    .innerJoin(factKeys, eq(facts.key, factKeys.key))
    .where(eq(facts.companyId, companyId))
    .orderBy(facts.companyId, facts.key, facts.qualifiers, desc(facts.createdAt), desc(facts.id));
  let factsCsv = csvRow([
    "key", "area", "type", "value_num", "value_text", "value_date", "value_bool", "value_json",
    "currency", "unit", "qualifiers", "as_of", "confidence", "note", "tags",
    "source_ids", "created_by", "created_at",
  ]);
  for (const fact of factRows) {
    factsCsv += csvRow([
      fact.key, fact.area, fact.valueType, fact.valueNum, fact.valueText, fact.valueDate,
      fact.valueBool, fact.valueJson, fact.currency, fact.unit, fact.qualifiers, fact.asOf,
      fact.confidence, fact.note, (fact.tags ?? []).join("|"),
      fact.sourceIds, fact.createdBy, fact.createdAt.toISOString(),
    ]);
  }
  await writeFile(join(dir, "facts.csv"), factsCsv, "utf8");

  const recordRows = await db
    .select()
    .from(records)
    .where(eq(records.companyId, companyId))
    .orderBy(records.type, records.updatedAt);
  const byType = new Map<string, typeof recordRows>();
  for (const row of recordRows) {
    const list = byType.get(row.type) ?? [];
    list.push(row);
    byType.set(row.type, list);
  }
  const recordCounts: Record<string, number> = {};
  for (const [type, rows] of byType) {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r.data as Record<string, unknown>)))].sort();
    let csv = csvRow(["id", ...keys, "source_ids", "tags", "first_seen_run_id", "last_seen_run_id", "created_by", "updated_at"]);
    for (const row of rows) {
      const data = row.data as Record<string, unknown>;
      csv += csvRow([
        row.id,
        ...keys.map((k) => data[k] ?? null),
        row.sourceIds.join("|"),
        row.tags.join("|"),
        row.firstSeenRunId,
        row.lastSeenRunId,
        row.createdBy,
        row.updatedAt.toISOString(),
      ]);
    }
    await writeFile(join(dir, `records-${type}.csv`), csv, "utf8");
    recordCounts[type] = rows.length;
  }

  return { dir, documents: documentCount, facts: factRows.length, records: recordCounts, skipped };
}
