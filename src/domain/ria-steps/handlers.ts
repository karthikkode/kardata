import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, documents, facts, factsCurrent, researchRuns } from "../../db/schema.js";
import { DEFAULT_ENDPOINTS } from "../../collect/collectors/types.js";
import { secFirmCollector } from "../../collect/collectors/sec-firm.js";
import { fetchUrl } from "../../collect/fetch.js";
import { normalizeDomain } from "../../lib/apollo/parse.js";
import { pdfText } from "../../lib/sec/pdf-text.js";
import { toEffectiveCompany } from "../companies.js";
import { addFacts } from "../research/facts.js";
import { saveDocument } from "../research/documents.js";
import { upsertRecords } from "../research/records.js";
import { recordVerdicts } from "../tiering.js";
import { splitBrochureItems } from "./brochure.js";
import type { StepHandler, StepResult } from "./runner.js";
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
    .values({ id: randomUUID(), companyId, kind: "manual", status: "running", stage: stage as never, promptVersion: "ria-light-v1", startedAt: new Date() })
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

const IAPD_API = "https://api.adviserinfo.sec.gov";
const IAPD_FILES = "https://files.adviserinfo.sec.gov";
let iapdApiBase = IAPD_API;
let iapdFilesBase = IAPD_FILES;
export function setBrochureBasesForTests(api: string | null, files: string | null): void {
  iapdApiBase = api ?? IAPD_API;
  iapdFilesBase = files ?? IAPD_FILES;
}

export interface BrochureChoice {
  versionId: number;
  name: string;
  dateSubmitted: string; // ISO yyyy-mm-dd
}

export function parseBrochureChoice(iacontent: unknown): { exempt: boolean; choice: BrochureChoice | null } {
  const brochures = (iacontent as { brochures?: { part2ExemptFlag?: string; brochuredetails?: unknown[] } } | null)?.brochures;
  if (!brochures) return { exempt: false, choice: null };
  if ((brochures.part2ExemptFlag ?? "").trim().toUpperCase() === "Y") return { exempt: true, choice: null };
  const details = (brochures.brochuredetails ?? [])
    .map((d) => {
      const o = d as { brochureVersionID?: number; brochureName?: string; dateSubmitted?: string };
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((o.dateSubmitted ?? "").trim());
      if (!o.brochureVersionID || !m) return null;
      const iso = `${m[3]}-${String(Number(m[1])).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
      return { versionId: o.brochureVersionID, name: o.brochureName ?? "", dateSubmitted: iso };
    })
    .filter((d): d is BrochureChoice => d !== null);
  if (details.length === 0) return { exempt: false, choice: null };
  // Prefer the firm brochure (Part 2A) over 2B supplements and wrap-fee
  // program brochures when both kinds are filed.
  const firm = details.filter((d) => !/2b|wrap/i.test(d.name));
  const pool = firm.length > 0 ? firm : details;
  const choice = pool.reduce((a, b) => (b.dateSubmitted > a.dateSubmitted ? b : a));
  return { exempt: false, choice };
}

export const brochureStep: StepHandler = async (db, _sectorId, companyId) => {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company?.secCrd) return { status: "gap", reason: "no SEC CRD" };
  const crd = company.secCrd;
  const runId = await newRun(db, companyId, "collect");
  const finish = async (r: StepResult): Promise<StepResult> => {
    await finishRun(db, runId, true);
    return r;
  };
  try {
    // 1. The IAPD firm record lists filed brochures (the reports.* PDF
    // URLs are not public; the files.* aspx endpoint is).
    const lookupUrl = `${iapdApiBase}/search/firm/${encodeURIComponent(crd)}?hl=true&nrows=12&query=${encodeURIComponent(crd)}&r=25&sort=score%2Bdesc&wt=json`;
    const lookup = await fetchUrl(db, {
      companyId,
      runId,
      collector: "ria_brochure",
      url: lookupUrl,
      userAgent: SEC_UA,
      accept: "application/json",
      privateHostAllowlist: privateHosts,
    });
    if (lookup.source.status !== "ok" || !lookup.text) {
      return finish({ status: "gap", reason: `brochure lookup fetch error (HTTP ${lookup.source.httpStatus ?? lookup.source.status})`, inputHash: crd });
    }
    let choice: BrochureChoice | null = null;
    try {
      const parsed = JSON.parse(lookup.text) as { hits?: { hits?: { _source?: { iacontent?: string } }[] } };
      const iacontent = parsed.hits?.hits?.[0]?._source?.iacontent;
      const inner: unknown = typeof iacontent === "string" ? JSON.parse(iacontent) : null;
      const result = parseBrochureChoice(inner);
      if (result.exempt) return finish({ status: "gap", reason: "exempt from Part 2 brochure", inputHash: crd });
      choice = result.choice;
    } catch {
      return finish({ status: "gap", reason: "brochure lookup unreadable (invalid IAPD response)", inputHash: crd });
    }
    if (!choice) return finish({ status: "gap", reason: "no brochure filed", inputHash: crd });

    // Already stored at this version: skip the download.
    const existing = await db
      .select({ title: documents.title })
      .from(documents)
      .where(and(eq(documents.companyId, companyId), eq(documents.path, "financials/brochure-item-5.md")));
    const already = existing.some((d) => d.title.includes(`v${choice.versionId})`));
    const twoYearsAgo = new Date(Date.now() - 2 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    const stale = choice.dateSubmitted < twoYearsAgo;
    if (already) {
      return finish(
        stale
          ? { status: "gap", reason: "brochure older than 2 years", inputHash: String(choice.versionId) }
          : { status: "done", reason: `brochure v${choice.versionId} (${choice.dateSubmitted}) already stored`, inputHash: String(choice.versionId) },
      );
    }

    // 2. The public brochure PDF endpoint, keyed by brochure version id.
    const pdfUrl = `${iapdFilesBase}/IAPD/Content/Common/crd_iapd_Brochure.aspx?BRCHR_VRSN_ID=${choice.versionId}`;
    const res = await fetchUrl(db, {
      companyId,
      runId,
      collector: "ria_brochure",
      url: pdfUrl,
      userAgent: SEC_UA,
      accept: "application/pdf",
      privateHostAllowlist: privateHosts,
    });
    if (res.source.status !== "ok" || !res.body) {
      return finish({ status: "gap", reason: `brochure fetch error (HTTP ${res.source.httpStatus ?? res.source.status})`, inputHash: String(choice.versionId) });
    }
    let text: string;
    try {
      text = await pdfText(res.body);
    } catch {
      return finish({ status: "gap", reason: "brochure unreadable (PDF text extraction failed)", inputHash: String(choice.versionId) });
    }
    const items = splitBrochureItems(text);
    const found = Object.keys(items);
    if (found.length === 0) {
      return finish({ status: "gap", reason: "brochure has no Item headings (scanned?)", inputHash: String(choice.versionId) });
    }
    for (const item of found) {
      await saveDocument(db, {
        companyId,
        runId,
        path: `financials/brochure-item-${item}.md`,
        title: `Part 2A brochure Item ${item} (${choice.dateSubmitted}, v${choice.versionId})`,
        contentMd: items[item] as string,
        sourceIds: [res.source.id],
        createdBy: "collector:ria_brochure",
      });
    }
    if (stale) return finish({ status: "gap", reason: "brochure older than 2 years", inputHash: String(choice.versionId) });
    return finish({ status: "done", reason: `items ${found.join(",")}, brochure ${choice.dateSubmitted} (v${choice.versionId})`, inputHash: String(choice.versionId) });
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
        { key: "ria.fee_schedule", value: String(json["fee_schedule"] ?? ""), q: quoteFor("fee_schedule") },
        { key: "ria.fee_family_grouping", value: json["family_grouping"] === true, q: quoteFor("family_grouping") },
        { key: "ria.fee_negotiable", value: json["negotiable"] === true, q: quoteFor("negotiable") },
        { key: "ria.fee_types", value: Array.isArray(json["fee_types"]) ? (json["fee_types"] as string[]) : [], q: quoteFor("fee_types") },
        { key: "ria.fee_minimums", value: String(json["minimums"] ?? ""), q: quoteFor("minimums") },
        { key: "ria.fee_billing", value: String(json["billing"] ?? "unknown"), q: quoteFor("billing") },
        { key: "ria.fee_proration", value: json["proration"] === true, q: quoteFor("proration") },
        { key: "ria.fee_refunds", value: json["refunds"] === true, q: quoteFor("refunds") },
        { key: "ria.fee_collection", value: String(json["collection"] ?? ""), q: quoteFor("collection") },
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
        const bad = written.find((r) => !r.ok);
        if (bad && !bad.ok) throw new Error(`fee fact write failed: ${bad.error}`);
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

// ---- B6: contacts ----

export function teamLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{0,60})<\/a>/gi)) {
    const href = m[1] ?? "";
    const label = `${href} ${m[2] ?? ""}`.toLowerCase();
    if (!/(team|people|about|leadership|our-firm|who-we-are)/.test(label)) continue;
    try {
      const url = new URL(href, base).toString();
      if (!out.includes(url)) out.push(url);
    } catch {
      // Bad href: skip.
    }
    if (out.length >= 3) break;
  }
  return out;
}

export const PEOPLE_SCHEMA = JSON.stringify({
  type: "object",
  additionalProperties: false,
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" }, title: { type: "string" }, quote: { type: "string" } },
        required: ["name", "title", "quote"],
      },
    },
  },
  required: ["people"],
});

export function createContactsStep(call: ExtractorCall = dockerExtractorCall): StepHandler {
  return async (db, _sectorId, companyId) => {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company?.website) return { status: "gap", reason: "no firm website" };
    const runId = await newRun(db, companyId, "collect");
    try {
      const home = await fetchUrl(db, { companyId, runId, collector: "ria_contacts", url: company.website, userAgent: SEC_UA, privateHostAllowlist: privateHosts });
      if (home.source.status !== "ok" || !home.text) {
        await finishRun(db, runId, true);
        return { status: "gap", reason: `website fetch ${home.source.status}`, inputHash: company.website };
      }
      const links = teamLinks(home.text, company.website);
      let pageText: string | null = null;
      let pageSource: string | null = null;
      for (const link of links) {
        const page = await fetchUrl(db, { companyId, runId, collector: "ria_contacts", url: link, userAgent: SEC_UA, privateHostAllowlist: privateHosts });
        if (page.source.status === "ok" && page.text && page.text.length > 200) {
          pageText = page.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 25_000);
          pageSource = page.source.id;
          break;
        }
      }
      if (!pageText || !pageSource) {
        await finishRun(db, runId, true);
        return { status: "gap", reason: "no team/about page found", inputHash: company.website };
      }
      const prompt = [
        "From this firm team/about page text, list people with their titles. Return one JSON object: {\"people\": [{\"name\": \"...\", \"title\": \"...\", \"quote\": \"verbatim passage naming the person and title\"}]}. No tools. Names and titles only.",
        "",
        pageText,
      ].join("\n");
      const result = await call({ runId, area: "people_and_ops", prompt, schema: PEOPLE_SCHEMA });
      const json = result.json as { people?: { name?: string; title?: string; quote?: string }[] };
      const people = (json.people ?? []).filter((p) => typeof p.name === "string" && p.name.trim() !== "");
      if (people.length > 0) {
        await upsertRecords(db, {
          companyId,
          runId,
          createdBy: "extractor:ria_contacts",
          records: people.slice(0, 30).map((p) => ({
            type: "leader",
            data: { name: String(p.name), title: String(p.title ?? "") },
            sourceIds: [pageSource as string],
            quote: typeof p.quote === "string" ? p.quote : null,
            quoteSourceId: pageSource,
          })),
        });
      }
      await finishRun(db, runId, true);
      return { status: "done", reason: `${people.length} people from team page`, tokensUsed: result.usage?.inputTokens ?? null, inputHash: company.website };
    } catch (err) {
      await finishRun(db, runId, false);
      throw err;
    }
  };
}

// ---- B7: signals, code only ----

export interface RiaSignals {
  fee_complexity: boolean;
  multi_custodian: boolean;
  growth: boolean;
  fee_problem: boolean;
  tool_sprawl: boolean;
  score: number;
}

export function computeSignals(input: {
  familyGrouping: boolean;
  negotiable: boolean;
  feeTypeCount: number;
  billing: string | null;
  proration: boolean;
  refunds: boolean;
  custodians: string | null;
  growthPct: number | null;
  disclosureFee: boolean;
  systemCount: number;
}): RiaSignals {
  const feeSignals = [
    input.familyGrouping,
    input.negotiable,
    input.feeTypeCount >= 2,
    (input.billing === "advance" || input.billing === "both") && (input.proration || input.refunds),
  ].filter(Boolean).length;
  const signals: Omit<RiaSignals, "score"> = {
    fee_complexity: feeSignals >= 2,
    multi_custodian: input.custodians !== null && (input.custodians.match(/,| and |;|\|/g)?.length ?? 0) >= 1 && input.custodians.trim().length > 3,
    growth: input.growthPct !== null && input.growthPct >= 0.2,
    fee_problem: input.disclosureFee,
    tool_sprawl: input.systemCount >= 2,
  };
  return { ...signals, score: Object.values(signals).filter(Boolean).length };
}

export const signalsStep: StepHandler = async (db, sectorId, companyId) => {
  const rows = await db.select().from(factsCurrent).where(eq(factsCurrent.companyId, companyId));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const boolOf = (key: string): boolean => byKey.get(key)?.valueBool === true;
  const textOf = (key: string): string | null => {
    const v = byKey.get(key)?.valueText;
    return typeof v === "string" && v !== "" ? v : null;
  };
  const types = byKey.get("ria.fee_types")?.valueJson;
  const feeTypeCount = Array.isArray(types) ? types.length : 0;
  const systemCount = rows.filter((r) => r.key.startsWith("firm.system_")).length;
  // Growth from AUM/staff history (facts table, oldest vs newest by asOf).
  const history = await db
    .select()
    .from(facts)
    .where(eq(facts.companyId, companyId))
    .orderBy(asc(facts.createdAt));
  let growthPct: number | null = null;
  for (const key of ["firm.regulatory_aum", "financials.employees"] as const) {
    const pts = history
      .filter((f) => f.key === key && f.valueNum !== null && f.asOf)
      .map((f) => ({ n: Number(f.valueNum), d: String(f.asOf).slice(0, 10) }))
      .filter((x) => Number.isFinite(x.n))
      .sort((a, b) => a.d.localeCompare(b.d));
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last || first === last || first.n <= 0) continue;
    const days = (new Date(last.d).getTime() - new Date(first.d).getTime()) / 86_400_000;
    if (days >= 180) growthPct = Math.max(growthPct ?? -Infinity, (last.n - first.n) / first.n);
  }
  if (growthPct === -Infinity) growthPct = null;
  const item9 = await brochureItemText(db, companyId, "9");
  const disclosureFee =
    boolOf("firm.fee_problem") ||
    (textOf("firm.disclosure_flag") === "Y" && item9 !== null && /fee|refund|billing/i.test(item9.text));
  const signals = computeSignals({
    familyGrouping: boolOf("ria.fee_family_grouping"),
    negotiable: boolOf("ria.fee_negotiable"),
    feeTypeCount,
    billing: textOf("ria.fee_billing"),
    proration: boolOf("ria.fee_proration"),
    refunds: boolOf("ria.fee_refunds"),
    custodians: textOf("firm.custodians"),
    growthPct,
    disclosureFee,
    systemCount,
  });
  const entries = Object.entries(signals).filter(([k]) => k !== "score") as [string, boolean][];
  const packHash = createHash("sha256").update(rows.map((r) => r.id).sort().join(",")).digest("hex").slice(0, 16);
  const runId = await newRun(db, companyId, "icp");
  const { companyIcpChecks } = await import("../../db/schema.js");
  const checkId = randomUUID();
  await db.insert(companyIcpChecks).values({
    id: checkId,
    companyId,
    sectorId,
    runId,
    promptVersion: "ria-light-v1",
    packHash,
    score: signals.score,
    status: "icp_accepted",
    results: {
      signals: entries.map(([key, on]) => ({ key, verdict: on ? "yes" : "no", counted: on, refs: [], observation: on ? `${key} from stored facts` : "", note: null })),
      exclusions: [],
      flags: [],
    },
    evidence: [],
    usage: null,
  });
  await recordVerdicts(db, [
    {
      companyId,
      sectorId,
      status: "icp_accepted",
      score: signals.score,
      signals: Object.fromEntries(entries),
      exclusionReason: null,
      source: `ria-light-v1:${checkId}`,
    },
  ]);
  await finishRun(db, runId, true);
  return { status: "done", reason: `score ${signals.score} (complex ${signals.fee_complexity}, growth ${signals.growth})`, inputHash: packHash };
};
