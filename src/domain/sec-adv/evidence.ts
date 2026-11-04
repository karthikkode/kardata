import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DbLike } from "../../db/client.js";
import { sources } from "../../db/schema.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import { DomainError } from "../errors.js";
import { findEvidenceLibrary } from "../evidence-library.js";

export const SNAPSHOT_COLLECTOR = "sec_adv_snapshot";
export const SCHEDULE_COLLECTOR = "sec_adv_schedules";

export async function lockEvidence(db: DbLike, key: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function canonicalFile(db: DbLike, input: {
  collector: string;
  release: string;
  url: string;
  filename: string;
  digest: string;
  member?: string;
}) {
  const library = await findEvidenceLibrary(db);
  if (!library) throw new DomainError("invalid_input", "run evidence_library_ensure first");
  await lockEvidence(db, `${input.collector}:${input.release}`);
  const [existing] = await db.select().from(sources).where(and(
    eq(sources.companyId, library.companyId),
    eq(sources.collector, input.collector),
    sql`${sources.details}->>'release' = ${input.release}`,
  ));
  if (existing) {
    if (existing.details?.digest !== input.digest || existing.url !== input.url) {
      throw new DomainError("conflict", `another SEC file is registered for ${input.release}`);
    }
    return existing;
  }
  const [source] = await db.insert(sources).values({
    id: randomUUID(),
    companyId: library.companyId,
    runId: await getOrCreateManualRun(db, library.companyId),
    url: input.url,
    finalUrl: input.url,
    title: input.filename,
    status: "ok",
    collector: input.collector,
    details: { release: input.release, digest: input.digest, member: input.member },
  }).returning();
  if (!source) throw new Error("could not register SEC file source");
  return source;
}

export async function companyFileEvidence(db: DbLike, file: typeof sources.$inferSelect, companyId: string, details: Record<string, unknown>) {
  const runId = await getOrCreateManualRun(db, companyId);
  const [source] = await db.insert(sources).values({
    id: randomUUID(),
    companyId,
    runId,
    collector: file.collector,
    url: file.url,
    finalUrl: file.finalUrl,
    title: file.title,
    status: "ok",
    details: { ...details, release: file.details?.release, fileSourceId: file.id },
  }).returning();
  if (!source) throw new Error("could not record company SEC evidence");
  return source;
}
