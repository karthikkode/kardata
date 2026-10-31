import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, researchRuns } from "../../db/schema.js";
import { DEFAULT_ENDPOINTS } from "../../collect/collectors/types.js";
import { secFirmCollector } from "../../collect/collectors/sec-firm.js";
import { normalizeDomain } from "../../lib/apollo/parse.js";
import { toEffectiveCompany } from "../companies.js";
import type { StepHandler } from "./runner.js";

/** RIA light steps (Stage 5.8 B3-B7): code first, one AI call where text must be read. */

export const SEC_UA = "Kardata karthik@kardata.co";
let privateHosts: string[] = [];
export function setPrivateHostsForTests(hosts: string[] | null): void { privateHosts = hosts ?? []; }
const SOCIAL = /(linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com)/i;

export function pickFirmWebsite(website: string | null): string | null {
  if (!website) return null;
  if (SOCIAL.test(website)) return null;
  const domain = normalizeDomain(website);
  return domain ? `https://www.${domain.replace(/^www\./, "")}` : null;
}

async function newRun(db: Db, companyId: string, stage: string): Promise<string> {
  const [row] = await db
    .insert(researchRuns)
    .values({ id: randomUUID(), companyId, kind: "collect", status: "running", stage: stage as never, promptVersion: "ria-light-v1", startedAt: new Date() })
    .returning({ id: researchRuns.id });
  if (!row) throw new Error("run insert returned no row");
  return row.id;
}

async function finishRun(db: Db, runId: string, ok: boolean): Promise<void> {
  await db
    .update(researchRuns)
    .set({ status: ok ? "succeeded" : "failed", finishedAt: new Date() })
    .where(eq(researchRuns.id, runId));
}

// ---- B3: firm data, code only ----

export function createFirmDataStep(endpoints = DEFAULT_ENDPOINTS): StepHandler {
  return async (db, _sectorId, companyId) => {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return { status: "failed", reason: "company gone" };
  if (!company.secCrd) return { status: "gap", reason: "no SEC CRD" };
  const picked = pickFirmWebsite(company.website);
  if ((company.website ?? null) !== picked) {
    await db
      .update(companies)
      .set({ website: picked, domain: picked ? normalizeDomain(picked) : company.domain })
      .where(eq(companies.id, companyId));
  }
  const runId = await newRun(db, companyId, "collect");
  try {
    const [fresh] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!fresh) return { status: "failed", reason: "company gone" };
    const result = await secFirmCollector.run({
      db,
      runId,
      companyId,
      company: fresh,
      effective: toEffectiveCompany(fresh),
      endpoints,
      privateHostAllowlist: privateHosts,
      shared: {},
    });
    const done = result.outcomes.some((o) => o.status === "done");
    await finishRun(db, runId, true);
    if (done) return { status: "done", inputHash: fresh.secCrd };
    const first = result.outcomes[0];
    return { status: "gap", reason: first?.reason ?? "firm not found on IAPD", inputHash: fresh.secCrd };
  } catch (err) {
    await finishRun(db, runId, false);
    throw err;
  }
  };
}

