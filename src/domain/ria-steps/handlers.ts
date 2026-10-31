import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, researchRuns } from "../../db/schema.js";
import { DEFAULT_ENDPOINTS } from "../../collect/collectors/types.js";
import { secFirmCollector } from "../../collect/collectors/sec-firm.js";
import { fetchUrl } from "../../collect/fetch.js";
import { normalizeDomain } from "../../lib/apollo/parse.js";
import { pdfText } from "../../lib/sec/pdf-text.js";
import { toEffectiveCompany } from "../companies.js";
import { saveDocument } from "../research/documents.js";
import { brochureDate, splitBrochureItems } from "./brochure.js";
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

// ---- B4: brochure text ----

const REPORTS = "https://reports.adviserinfo.sec.gov";
let reportsBase = REPORTS;
export function setReportsBaseForTests(base: string | null): void { reportsBase = base ?? REPORTS; }

export async function brochureUrls(crd: string): Promise<string[]> {
  return [
    `${reportsBase}/reports/ADV/${crd}/Part2ABrochure/${crd}.pdf`,
    `${reportsBase}/reports/ADV/${crd}/Part2ABrochure.pdf`,
  ];
}

export const brochureStep: StepHandler = async (db, _sectorId, companyId) => {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company?.secCrd) return { status: "gap", reason: "no SEC CRD" };
  const runId = await newRun(db, companyId, "collect");
  try {
    let text: string | null = null;
    let sourceId: string | null = null;
    for (const url of await brochureUrls(company.secCrd)) {
      const res = await fetchUrl(db, {
        companyId,
        runId,
        collector: "ria_brochure",
        url,
        userAgent: SEC_UA,
        accept: "application/pdf",
        privateHostAllowlist: privateHosts,
      });
      if (res.source.status === "ok" && res.body && res.body.length > 500) {
        try {
          text = await pdfText(res.body);
          sourceId = res.source.id;
          break;
        } catch {
          // Unreadable PDF: try the next pattern, else gap below.
        }
      }
    }
    if (!text || !sourceId) {
      await finishRun(db, runId, true);
      return { status: "gap", reason: "brochure not publicly downloadable (IAPD auth) or unreadable", inputHash: company.secCrd };
    }
    const items = splitBrochureItems(text);
    const date = brochureDate(text);
    const found = Object.keys(items);
    if (found.length === 0) {
      await finishRun(db, runId, true);
      return { status: "gap", reason: "brochure text has no Item headings (scanned?)", inputHash: company.secCrd };
    }
    for (const item of found) {
      await saveDocument(db, {
        companyId,
        runId,
        path: `financials/brochure-item-${item}.md`,
        title: `Part 2A brochure Item ${item}${date ? ` (${date})` : ""}`,
        contentMd: items[item] as string,
        sourceIds: [sourceId],
        createdBy: "collector:ria_brochure",
      });
    }
    await finishRun(db, runId, true);
    const hash = createHash("sha256").update(text.slice(0, 20_000)).digest("hex").slice(0, 16);
    return { status: "done", reason: `items ${found.join(",")}${date ? `, brochure ${date}` : ""}`, inputHash: hash };
  } catch (err) {
    await finishRun(db, runId, false);
    throw err;
  }
};

