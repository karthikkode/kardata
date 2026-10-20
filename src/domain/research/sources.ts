import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import { blobs, companies, researchRuns, sources } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { isHttpUrl } from "./validate.js";

export const CAPTURE_VIA = ["search", "browser", "muse_fetch"] as const;
export type CaptureVia = (typeof CAPTURE_VIA)[number];

export interface CaptureSourceInput {
  companyId: string;
  runId: string;
  url: string;
  title?: string;
  text: string;
  via: string;
  createdBy: string;
}

// Store content the agent already saw some other way (a search snippet, a
// rendered page's text, a prompt-fetch), so it has an id and a snapshot.
export async function captureSource(db: DbLike, input: CaptureSourceInput): Promise<string> {
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

  const body = Buffer.from(input.text, "utf8");
  const sha = createHash("sha256").update(body).digest("hex");
  await db
    .insert(blobs)
    .values({
      sha256: sha,
      contentType: "text/plain; charset=utf-8",
      size: body.byteLength,
      gzip: gzipSync(body),
    })
    .onConflictDoNothing();
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
      blobSha256: sha,
    })
    .returning({ id: sources.id });
  if (!row) throw new Error("source insert returned no row");
  return row.id;
}
