import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/client.js";
import {
  areaStatuses,
  companies,
  documents,
  facts,
  records,
  researchRuns,
  sources,
  type NewCompany,
} from "../../src/db/schema.js";
import type { CollectorCtx } from "../../src/collect/collectors/types.js";
import { toEffectiveCompany } from "../../src/domain/companies.js";
import type { FakeSite } from "./fake-site.js";

export async function seedCompany(db: Db, opts: Partial<NewCompany> = {}): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name: "Fake Site Co", ...opts })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

export async function seedRun(db: Db, companyId: string): Promise<string> {
  const [row] = await db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "collect", status: "running" })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("no run row");
  return row.id;
}

export const ALLOW = ["127.0.0.1"];

// Collector tests point every endpoint at one fake host, so shrink the
// per-host delay for the file. Callers must call restoreHostDelay after.
export function shrinkHostDelay(): string | undefined {
  const prev = process.env.KARDATA_HOST_DELAY_MS;
  process.env.KARDATA_HOST_DELAY_MS = "5";
  return prev;
}

export function restoreHostDelay(prev: string | undefined): void {
  if (prev === undefined) delete process.env.KARDATA_HOST_DELAY_MS;
  else process.env.KARDATA_HOST_DELAY_MS = prev;
}

export async function collectorCtx(
  db: Db,
  site: FakeSite,
  companyId: string,
  runId: string,
): Promise<CollectorCtx> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error("no company row");
  const base = site.baseUrl;
  return {
    db,
    runId,
    companyId,
    company,
    effective: toEffectiveCompany(company),
    endpoints: {
      gdelt: base,
      secEfts: base,
      secData: base,
      cdx: base,
      wayback: base,
      greenhouse: base,
      lever: base,
      ashby: base,
      workable: base,
      companiesHouse: base,
    },
    privateHostAllowlist: ALLOW,
    shared: {},
  };
}

export async function docsForRun(db: Db, runId: string) {
  return db.select().from(documents).where(eq(documents.runId, runId));
}

export async function factsForRun(db: Db, runId: string) {
  return db.select().from(facts).where(eq(facts.runId, runId));
}

export async function recordsForRun(db: Db, runId: string) {
  return db
    .select()
    .from(records)
    .where(eq(records.lastSeenRunId, runId));
}

export async function statusesForRun(db: Db, runId: string) {
  return db.select().from(areaStatuses).where(eq(areaStatuses.runId, runId));
}

export async function sourceById(db: Db, id: string) {
  const [row] = await db.select().from(sources).where(eq(sources.id, id));
  return row;
}
