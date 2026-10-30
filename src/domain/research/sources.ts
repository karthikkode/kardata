import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import { blobs, companies, researchRuns, sources } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { isHttpUrl } from "./validate.js";

export const CAPTURE_VIA = ["search", "browser", "muse_fetch"] as const;
export type CaptureVia = (typeof CAPTURE_VIA)[number];

export const APOLLO_IMPORT_COLLECTOR = "apollo_import";

export function apolloImportUrl(importId: string, apolloAccountId: string): string {
  return `apollo:import/${importId}/${apolloAccountId}`;
}

export async function storeBlob(db: DbLike, contentType: string, body: Buffer): Promise<string> {
  const sha = createHash("sha256").update(body).digest("hex");
  await db
    .insert(blobs)
    .values({ sha256: sha, contentType, size: body.byteLength, gzip: gzipSync(body) })
    .onConflictDoNothing();
  return sha;
}

export interface CaptureSourceInput {
  companyId: string;
  runId: string;
  url: string;
  title?: string;
  text: string;
  via: string;
  /** Verbatim relied-upon passages; required for browser | muse_fetch. */
  passages?: string[];
  createdBy: string;
}

export interface CaptureSourceResult {
  sourceId: string;
  thin: boolean;
  warnings: string[];
}

export const THIN_CAPTURE_CHARS = 200;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Store content the agent already saw some other way (a search snippet, a
// rendered page's text, a prompt-fetch), so it has an id and a snapshot.
export async function captureSource(db: DbLike, input: CaptureSourceInput): Promise<CaptureSourceResult> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  const [run] = await db
    .select({ id: researchRuns.id, companyId: researchRuns.companyId })
    .from(researchRuns)
    .where(eq(researchRuns.id, input.runId));
  if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
  if (run.companyId !== input.companyId) {
    throw new DomainError("invalid_input", `run ${input.runId} belongs to another company`);
  }
  if (!isHttpUrl(input.url)) {
    throw new DomainError("invalid_input", `capture needs an http(s) URL, got "${input.url}"`);
  }
  if (!(CAPTURE_VIA as readonly string[]).includes(input.via)) {
    throw new DomainError("invalid_input", `via must be ${CAPTURE_VIA.join(", ")}`);
  }
  if (input.text.trim() === "") throw new DomainError("invalid_input", "capture needs text");
  const needsPassages = input.via === "browser" || input.via === "muse_fetch";
  const passages = (input.passages ?? []).map((p) => p.trim()).filter((p) => p !== "");
  if (needsPassages && passages.length === 0) {
    throw new DomainError("invalid_input", `via ${input.via} needs passages: the verbatim excerpt(s) relied on`);
  }
  const snapshot = collapseWhitespace(input.text);
  for (const passage of passages) {
    if (!snapshot.includes(collapseWhitespace(passage))) {
      throw new DomainError("invalid_input", "every passage must appear verbatim in text");
    }
  }

  const warnings: string[] = [];
  const thin = input.text.trim().length < THIN_CAPTURE_CHARS;
  if (thin) {
    warnings.push(
      `thin capture (${input.text.trim().length} chars < ${THIN_CAPTURE_CHARS}): quote fuller verbatim passages`,
    );
  }

  const body = Buffer.from(input.text, "utf8");
  const sha = await storeBlob(db, "text/plain; charset=utf-8", body);
  const [row] = await db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      runId: input.runId,
      url: input.url,
      finalUrl: input.url,
      collector: "capture",
      status: "ok",
      httpStatus: null,
      title: input.title?.trim() ? input.title.trim().slice(0, 500) : null,
      via: input.via,
      evidenceGrade: input.via === "search" || input.via === "muse_fetch" ? "secondary" : "primary",
      thin,
      blobSha256: sha,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("source insert returned no row");
  return { sourceId: row.id, thin, warnings };
}

export interface ApolloImportSourceInput {
  companyId: string;
  runId: string;
  importId: string;
  apolloAccountId: string;
  raw: unknown;
}

// One source per imported CSV row: the row's raw JSON, snapshotted so Apollo
// facts can cite it. Every import writes new rows (the URL embeds the import
// id); collectors cite the latest via findApolloImportSource.
export async function createApolloImportSource(db: DbLike, input: ApolloImportSourceInput): Promise<string> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  const [run] = await db
    .select({ id: researchRuns.id, companyId: researchRuns.companyId })
    .from(researchRuns)
    .where(eq(researchRuns.id, input.runId));
  if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
  if (run.companyId !== input.companyId) {
    throw new DomainError("invalid_input", `run ${input.runId} belongs to another company`);
  }
  const sha = await storeBlob(db, "application/json", Buffer.from(JSON.stringify(input.raw ?? {}), "utf8"));
  const url = apolloImportUrl(input.importId, input.apolloAccountId);
  const [row] = await db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      runId: input.runId,
      url,
      finalUrl: url,
      collector: APOLLO_IMPORT_COLLECTOR,
      status: "ok",
      blobSha256: sha,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("source insert returned no row");
  return row.id;
}

export const SEC_IMPORT_COLLECTOR = "sec_import";

export function secImportUrl(importId: string, crd: string): string {
  return `sec:import/${importId}/${crd}`;
}

export interface SecImportSourceInput {
  companyId: string;
  runId: string;
  importId: string;
  crd: string;
  raw: unknown;
}

/** One source per imported SEC row: the row JSON, snapshotted so SEC facts can cite it. */
export async function createSecImportSource(db: DbLike, input: SecImportSourceInput): Promise<string> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  const [run] = await db
    .select({ id: researchRuns.id, companyId: researchRuns.companyId })
    .from(researchRuns)
    .where(eq(researchRuns.id, input.runId));
  if (!run) throw new DomainError("not_found", `run not found: ${input.runId}`);
  if (run.companyId !== input.companyId) {
    throw new DomainError("invalid_input", `run ${input.runId} belongs to another company`);
  }
  const sha = await storeBlob(db, "application/json", Buffer.from(JSON.stringify(input.raw ?? {}), "utf8"));
  const url = secImportUrl(input.importId, input.crd);
  const [row] = await db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      runId: input.runId,
      url,
      finalUrl: url,
      collector: SEC_IMPORT_COLLECTOR,
      status: "ok",
      blobSha256: sha,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("source insert returned no row");
  return row.id;
}

// Latest apollo_import source for a company, if any.
export async function findApolloImportSource(
  db: DbLike,
  companyId: string,
): Promise<{ id: string } | null> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM sources
    WHERE company_id = ${companyId} AND collector = ${APOLLO_IMPORT_COLLECTOR}
    ORDER BY fetched_at DESC, id DESC LIMIT 1`);
  const list = rows as unknown as { id: string }[];
  return list[0] ?? null;
}
