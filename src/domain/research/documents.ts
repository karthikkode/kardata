import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  area,
  companies,
  documentKind,
  documents,
  facts,
  records,
  researchRuns,
  sources,
} from "../../db/schema.js";
import { DomainError, isUniqueViolation } from "../errors.js";

export const DOCUMENT_CONTENT_MAX = 500 * 1024;
export const DOCUMENT_PATH_MAX = 200;
export const DOCUMENT_PATH_PATTERN = /^[a-z0-9\-_/.]+\.md$/;

export interface SaveDocumentInput {
  companyId: string;
  runId?: string | null;
  path: string;
  kind?: string;
  title?: string;
  contentMd: string;
  sourceIds?: string[];
  factIds?: string[];
  recordIds?: string[];
  tags?: string[];
  createdBy: string;
}

export interface SaveDocumentResult {
  id: string;
  version: number;
  outcome: "created" | "updated" | "unchanged";
  warnings: string[];
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

export function areaForPath(path: string): string {
  const first = path.split("/")[0] ?? "";
  const names = area.enumValues as readonly string[];
  return names.includes(first) ? first : "other";
}

export async function saveDocument(db: DbLike, input: SaveDocumentInput): Promise<SaveDocumentResult> {
  const warnings: string[] = [];
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
  if (
    typeof input.path !== "string" ||
    input.path.length > DOCUMENT_PATH_MAX ||
    !DOCUMENT_PATH_PATTERN.test(input.path)
  ) {
    throw new DomainError(
      "invalid_input",
      `malformed document path "${input.path}": lowercase [a-z0-9-_/.], ending in .md, at most ${DOCUMENT_PATH_MAX} characters`,
    );
  }
  const kinds = documentKind.enumValues as readonly string[];
  let kind = "extract";
  if (input.kind !== undefined) {
    if (kinds.includes(input.kind)) kind = input.kind;
    else warnings.push(`unknown kind "${input.kind}"; stored as extract`);
  }
  if (input.contentMd.trim() === "") throw new DomainError("invalid_input", "document needs content");
  if (Buffer.byteLength(input.contentMd, "utf8") > DOCUMENT_CONTENT_MAX) {
    throw new DomainError("invalid_input", "document is over 500 KB; split into several files");
  }
  const basename = input.path.split("/").pop() ?? input.path;
  const title = (input.title?.trim() || basename.replace(/\.md$/, "")).slice(0, 300);
  const sourceIds = [...new Set(input.sourceIds ?? [])];
  const factIds = [...new Set(input.factIds ?? [])];
  const recordIds = [...new Set(input.recordIds ?? [])];
  await checkOwned(db, sources, "source", sourceIds, input.companyId);
  await checkOwned(db, facts, "fact", factIds, input.companyId);
  await checkOwned(db, records, "record", recordIds, input.companyId);

  let tags: string[] = [];
  if (input.tags !== undefined) {
    if (Array.isArray(input.tags) && input.tags.every((t) => typeof t === "string")) tags = input.tags;
    else warnings.push("tags must be an array of strings; stored without tags");
  }

  const sha = createHash("sha256").update(input.contentMd).digest("hex");
  const [current] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.companyId, input.companyId),
        eq(documents.path, input.path),
        eq(documents.isCurrent, true),
      ),
    );
  if (current && current.contentSha256 === sha) {
    return { id: current.id, version: current.version, outcome: "unchanged", warnings };
  }
  try {
    if (current) {
      await db.update(documents).set({ isCurrent: false }).where(eq(documents.id, current.id));
    }
    const [row] = await db
      .insert(documents)
      .values({
        id: randomUUID(),
        companyId: input.companyId,
        runId: input.runId ?? null,
        area: areaForPath(input.path) as typeof documents.$inferInsert.area,
        kind: kind as typeof documents.$inferInsert.kind,
        title,
        path: input.path,
        version: current ? current.version + 1 : 1,
        isCurrent: true,
        contentMd: input.contentMd,
        sourceIds,
        factIds,
        recordIds,
        tags,
        createdBy: input.createdBy,
        contentSha256: sha,
      })
      .returning({ id: documents.id, version: documents.version });
    if (!row) throw new Error("document insert returned no row");
    return { id: row.id, version: row.version, outcome: current ? "updated" : "created", warnings };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DomainError("conflict", `document "${input.path}" was saved concurrently; retry`);
    }
    throw err;
  }
}
