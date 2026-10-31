import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, documents, researchRuns } from "../../db/schema.js";
import { DEFAULT_ENDPOINTS } from "../../collect/collectors/types.js";
import { secFirmCollector } from "../../collect/collectors/sec-firm.js";
import { fetchUrl } from "../../collect/fetch.js";
import { normalizeDomain } from "../../lib/apollo/parse.js";
import { pdfText } from "../../lib/sec/pdf-text.js";
import { toEffectiveCompany } from "../companies.js";
import { addFacts } from "../research/facts.js";
import { saveDocument } from "../research/documents.js";
import { brochureDate, splitBrochureItems } from "./brochure.js";
import type { StepHandler } from "./runner.js";
import { dockerExtractorCall, type ExtractorCall } from "../../runs/extract.js";

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

// ---- B5: fee terms, one AI call ----

export const FEE_SCHEMA = JSON.stringify({
  type: "object",
  additionalProperties: false,
  properties: {
    fee_schedule: { type: "string" },
    family_grouping: { type: "boolean" },
    negotiable: { type: "boolean" },
    fee_types: { type: "array", items: { type: "string" } },
    minimums: { type: "string" },
    billing: { type: "string", enum: ["advance", "arrears", "both", "unknown"] },
    proration: { type: "boolean" },
    refunds: { type: "boolean" },
    systems: { type: "array", items: { type: "string" } },
    collection: { type: "string" },
    quotes: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["fee_schedule", "family_grouping", "negotiable", "fee_types", "minimums", "billing", "proration", "refunds", "systems", "collection", "quotes"],
});

export function feePrompt(item5: string, item4: string): string {
  return [
    "Read this Form ADV Part 2A brochure text and return one JSON object matching the schema. No tools.",
    "fee_schedule: the schedule and tiers in plain words. family_grouping / negotiable / proration / refunds: true only when the text says so.",
    "fee_types: e.g. percentage_of_aum, flat, hourly, planning. billing: advance, arrears, both or unknown. collection: how fees are collected (e.g. deducted from account, invoiced). systems: software or platforms named.",
    "quotes: map each field you set to a verbatim passage (max 300 chars) copied EXACTLY from the text. Never invent a quote.",
    "",
    "## Item 5",
    item5.slice(0, 30_000),
    item4 ? `\n## Item 4\n${item4.slice(0, 10_000)}` : "",
  ].join("\n");
}

async function brochureItemText(db: Db, companyId: string, item: string): Promise<{ text: string; sourceIds: string[] } | null> {
  const all = await db
    .select()
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.path, `financials/brochure-item-${item}.md`)));
  const latest = all[all.length - 1];
  if (!latest) return null;
  return { text: latest.contentMd ?? "", sourceIds: latest.sourceIds ?? [] };
}

export function createFeesStep(call: ExtractorCall = dockerExtractorCall): StepHandler {
  return async (db, _sectorId, companyId) => {
    const item5 = await brochureItemText(db, companyId, "5");
    if (!item5 || item5.text.trim().length < 40) return { status: "gap", reason: "no brochure Item 5 stored" };
    const item4 = await brochureItemText(db, companyId, "4");
    const runId = await newRun(db, companyId, "extraction");
    try {
      const result = await call({ runId, area: "firm_and_fees", prompt: feePrompt(item5.text, item4?.text ?? ""), schema: FEE_SCHEMA });
      const json = result.json as Record<string, unknown>;
      const quotes = (json["quotes"] ?? {}) as Record<string, string>;
      const sourceIds = item5.sourceIds;
      const quoteFor = (key: string): string => (typeof quotes[key] === "string" ? (quotes[key] as string) : "");
      const items = [
        { key: "firm.fee_schedule", value: String(json["fee_schedule"] ?? ""), q: quoteFor("fee_schedule") },
        { key: "firm.fee_family_grouping", value: json["family_grouping"] === true, q: quoteFor("family_grouping") },
        { key: "firm.fee_negotiable", value: json["negotiable"] === true, q: quoteFor("negotiable") },
        { key: "firm.fee_types", value: Array.isArray(json["fee_types"]) ? (json["fee_types"] as string[]) : [], q: quoteFor("fee_types") },
        { key: "firm.fee_minimums", value: String(json["minimums"] ?? ""), q: quoteFor("minimums") },
        { key: "firm.fee_billing", value: String(json["billing"] ?? "unknown"), q: quoteFor("billing") },
        { key: "firm.fee_proration", value: json["proration"] === true, q: quoteFor("proration") },
        { key: "firm.fee_refunds", value: json["refunds"] === true, q: quoteFor("refunds") },
        { key: "firm.fee_collection", value: String(json["collection"] ?? ""), q: quoteFor("collection") },
      ].filter((i) => !(typeof i.value === "string" && i.value === "") && !(Array.isArray(i.value) && i.value.length === 0));
      const haystack = `${item5.text}
${item4?.text ?? ""}`.replace(/\s+/g, " ").toLowerCase();
      const grounded = items.filter((i) => i.q !== "" && haystack.includes(i.q.replace(/\s+/g, " ").toLowerCase().slice(0, 300)));
      const facts: { key: string; value: never; sourceIds: string[]; confidence: "high" | "medium" | "low"; quote: string | null; quoteSourceId: string | null }[] = grounded.map((i) => ({
        key: i.key,
        value: i.value as never,
        sourceIds,
        confidence: "high" as const,
        quote: i.q === "" ? null : i.q,
        quoteSourceId: i.q === "" || sourceIds.length === 0 ? null : (sourceIds[0] as string),
      }));
      const systemsQuote = quoteFor("systems");
      const systems = Array.isArray(json["systems"]) && systemsQuote !== "" && haystack.includes(systemsQuote.replace(/\s+/g, " ").toLowerCase().slice(0, 300)) ? (json["systems"] as string[]) : [];
      for (const sys of systems.slice(0, 8)) {
        facts.push({
          key: `firm.system_${sys.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}`,
          value: sys as never,
          sourceIds,
          confidence: "medium" as "high" | "medium" | "low",
          quote: systemsQuote === "" ? null : systemsQuote,
          quoteSourceId: null,
        });
      }
      if (facts.length > 0) {
        const written = await addFacts(db, { companyId, runId, createdBy: "extractor:ria_fees", facts });
        void written;
      }
      await finishRun(db, runId, true);
      const tokens = result.usage?.inputTokens ?? null;
      return { status: "done", tokensUsed: tokens, inputHash: createHash("sha256").update(item5.text.slice(0, 5000)).digest("hex").slice(0, 16) };
    } catch (err) {
      await finishRun(db, runId, false);
      throw err;
    }
  };
}

