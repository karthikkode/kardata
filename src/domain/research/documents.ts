import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import {
  area,
  companies,
  documentKind,
  documents,
  researchRuns,
  sources,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";

export interface SaveDocumentInput {
  companyId: string;
  runId?: string | null;
  area?: string | null;
  kind: string;
  title: string;
  contentMd: string;
  sourceIds?: string[];
  createdBy: string;
}

export async function saveDocument(db: DbLike, input: SaveDocumentInput): Promise<string> {
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
  if (!documentKind.enumValues.includes(input.kind as (typeof documentKind.enumValues)[number])) {
    throw new DomainError(
      "invalid_input",
      `unknown document kind "${input.kind}". Valid kinds: ${documentKind.enumValues.join(", ")}`,
    );
  }
  if (input.area !== undefined && input.area !== null && !area.enumValues.includes(input.area as (typeof area.enumValues)[number])) {
    throw new DomainError(
      "invalid_input",
      `unknown area "${input.area}". Valid areas: ${area.enumValues.join(", ")}`,
    );
  }
  if (input.title.trim() === "") throw new DomainError("invalid_input", "document needs a title");
  if (input.contentMd.trim() === "") throw new DomainError("invalid_input", "document needs content");
  const sourceIds = [...new Set(input.sourceIds ?? [])];
  if (sourceIds.length > 0) {
    const found = await db
      .select({ id: sources.id, companyId: sources.companyId })
      .from(sources)
      .where(inArray(sources.id, sourceIds));
    const byId = new Map(found.map((s) => [s.id, s]));
    for (const id of sourceIds) {
      const source = byId.get(id);
      if (!source) throw new DomainError("invalid_input", `unknown source ${id}`);
      if (source.companyId !== input.companyId) {
        throw new DomainError("invalid_input", `source ${id} belongs to another company`);
      }
    }
  }
  const [row] = await db
    .insert(documents)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      runId: input.runId ?? null,
      area: (input.area ?? null) as typeof documents.$inferInsert.area,
      kind: input.kind as typeof documents.$inferInsert.kind,
      title: input.title.slice(0, 300),
      contentMd: input.contentMd,
      sourceIds,
      createdBy: input.createdBy,
      contentSha256: createHash("sha256").update(input.contentMd).digest("hex"),
    })
    .returning({ id: documents.id });
  if (!row) throw new Error("document insert returned no row");
  return row.id;
}
