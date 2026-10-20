import { load } from "cheerio";
import type { AddFactItem } from "../../domain/research/facts.js";
import type { UpsertRecordItem } from "../../domain/research/records.js";
import type { Collector, CollectorCtx } from "./types.js";
import { collectFetch, fetchFailure, normalizeName, writeExtract, writeFacts, writeRecords } from "./util.js";

// SEC EDGAR full-text search JSON: GET https://efts.sec.gov/LATEST/search-index?q="name"&forms=D&dateRange=custom&startdt&enddt
// (verified live; params per https://www.sec.gov/edgar/sec-api-documentation). Filing XML at
// https://www.sec.gov/Archives/edgar/data/{cik}/{adsh}/{primary_doc}. SEC requires an email-style
// contact User-Agent ("Kardata <KARDATA_CONTACT_EMAIL>") and ≤10 req/s; the 2 s host delay keeps us far below.

const SEC_MAX_CANDIDATES = 5;
const SEC_SEARCH_YEARS = 10;

const US_STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas",
  KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts",
  MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico",
  NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma",
  OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota",
  TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};

function normalizeState(state: string): string {
  const clean = state.trim().toLowerCase().replace(/\./g, "");
  const upper = state.trim().toUpperCase().replace(/\./g, "");
  if (US_STATES[upper]) return US_STATES[upper] as string;
  return clean;
}

function statesMatch(a: string, b: string): boolean {
  return normalizeState(a) === normalizeState(b);
}

function isUS(country: string | null): boolean {
  if (!country) return false;
  const c = country.trim().toLowerCase();
  return c === "united states" || c === "united states of america" || c === "usa" || c === "us" || c === "u.s." || c === "u.s.a.";
}

interface SecCandidate {
  name: string;
  cik: string;
  form: string;
  fileDate: string;
  adsh: string;
  filename: string;
  bizStates: string[];
}

function parseSearch(text: string): SecCandidate[] {
  const parsed = JSON.parse(text) as {
    hits?: { hits?: { _id?: string; _source?: Record<string, unknown> }[] };
  };
  const hits = parsed?.hits?.hits ?? [];
  const out: SecCandidate[] = [];
  for (const hit of hits) {
    const src = hit._source ?? {};
    const id = typeof hit._id === "string" ? hit._id : "";
    const [adsh, filename] = id.split(":");
    const names = Array.isArray(src["display_names"]) ? (src["display_names"] as string[]) : [];
    const ciks = Array.isArray(src["ciks"]) ? (src["ciks"] as string[]) : [];
    const bizStates = Array.isArray(src["biz_states"]) ? (src["biz_states"] as string[]) : [];
    const form = typeof src["form"] === "string" ? (src["form"] as string) : "";
    const roots = Array.isArray(src["root_forms"]) ? (src["root_forms"] as string[]) : [];
    if (!form.startsWith("D") && !roots.includes("D")) continue;
    if (!adsh || !filename || names.length === 0 || ciks.length === 0) continue;
    out.push({
      name: String(names[0]).replace(/\s*\(CIK\s+\d+\)\s*$/, "").trim(),
      cik: String(ciks[0]).replace(/^0+/, "") || "0",
      form,
      fileDate: typeof src["file_date"] === "string" ? (src["file_date"] as string) : "",
      adsh: adsh.replace(/-/g, ""),
      filename,
      bizStates: bizStates.map(String),
    });
  }
  return out;
}

interface FormD {
  issuerName: string;
  issuerState: string;
  industryGroup: string;
  totalOffering: string;
  totalSold: string;
  investors: string;
}

function parseFormD(xml: string): FormD | null {
  const $ = load(xml, { xmlMode: true });
  const issuer = $("edgarSubmission > primaryIssuer");
  if (issuer.length === 0) return null;
  const offering = $("edgarSubmission > offeringData");
  return {
    issuerName: issuer.find("> entityName").first().text().trim(),
    issuerState: issuer.find("> issuerAddress > stateOrCountry").first().text().trim(),
    industryGroup: offering.find("industryGroupType").first().text().trim(),
    totalOffering: offering.find("totalOfferingAmount").first().text().trim(),
    totalSold: offering.find("totalAmountSold").first().text().trim(),
    investors: offering.find("totalNumberAlreadyInvested").first().text().trim(),
  };
}

export const secCollector: Collector = {
  name: "sec_form_d",
  areas: ["financials", "decisions"],
  run: async (ctx: CollectorCtx) => {
    if (!isUS(ctx.effective.country)) {
      const reason = `non-US company (${ctx.effective.country ?? "country unknown"})`;
      return {
        outcomes: [
          { area: "financials", status: "skipped" as const, reason },
          { area: "decisions", status: "skipped" as const, reason },
        ],
      };
    }
    const contactEmail = process.env.KARDATA_CONTACT_EMAIL?.trim() ?? "";
    if (contactEmail === "") {
      const reason = "no KARDATA_CONTACT_EMAIL";
      return {
        outcomes: [
          { area: "financials", status: "skipped" as const, reason },
          { area: "decisions", status: "skipped" as const, reason },
        ],
      };
    }
    const secUserAgent = `Kardata <${contactEmail}>`;
    const name = ctx.effective.name?.trim() ?? "";
    if (name === "") {
      const reason = "no company name to search";
      return {
        outcomes: [
          { area: "financials", status: "not_found" as const, reason },
          { area: "decisions", status: "not_found" as const, reason },
        ],
      };
    }
    const enddt = new Date().toISOString().slice(0, 10);
    const start = new Date();
    start.setFullYear(start.getFullYear() - SEC_SEARCH_YEARS);
    const startdt = start.toISOString().slice(0, 10);
    const url =
      `${ctx.endpoints.secEfts}/LATEST/search-index?` +
      `q=${encodeURIComponent(`"${name}"`)}&forms=D&dateRange=custom&startdt=${startdt}&enddt=${enddt}`;
    const res = await collectFetch(ctx, "sec_form_d", url, {
      accept: "application/json",
      userAgent: secUserAgent,
    });
    if (res.source.status !== "ok" || !res.text) {
      const status =
        res.source.status === "blocked" || res.source.status === "robots_disallowed"
          ? ("blocked" as const)
          : res.source.status === "error"
            ? ("error" as const)
            : ("not_found" as const);
      const reason = `SEC search: ${fetchFailure(res)}`;
      return {
        outcomes: [
          { area: "financials", status, reason },
          { area: "decisions", status, reason },
        ],
      };
    }
    let candidates: SecCandidate[];
    try {
      candidates = parseSearch(res.text);
    } catch {
      const reason = "SEC search returned invalid JSON";
      return {
        outcomes: [
          { area: "financials", status: "error" as const, reason },
          { area: "decisions", status: "error" as const, reason },
        ],
      };
    }

    const companyState = ctx.effective.state?.trim() ?? "";
    const wanted = normalizeName(name);
    const sourceIds = [res.source.id];
    for (const cand of candidates.slice(0, SEC_MAX_CANDIDATES)) {
      if (normalizeName(cand.name) !== wanted) continue;
      const xmlUrl = `${ctx.endpoints.secData}/Archives/edgar/data/${cand.cik}/${cand.adsh}/${cand.filename}`;
      const xml = await collectFetch(ctx, "sec_form_d", xmlUrl, {
        accept: "application/xml,text/xml;q=0.9",
        userAgent: secUserAgent,
      });
      if (xml.source.status !== "ok" || !xml.text) continue;
      const form = parseFormD(xml.text);
      if (!form || normalizeName(form.issuerName) !== wanted) continue;
      const issuerState = form.issuerState !== "" ? form.issuerState : (cand.bizStates[0] ?? "");
      if (companyState === "" || issuerState === "" || !statesMatch(issuerState, companyState)) {
        continue;
      }
      sourceIds.push(xml.source.id);
      const date = cand.fileDate !== "" ? cand.fileDate : "(date unknown)";
      const money = (v: string) => (v !== "" ? `$${Number(v).toLocaleString("en-US")}` : "unknown");
      await writeExtract(
        ctx,
        "sec_form_d",
        "financials/form-d.md",
        `Form D (${cand.form}, ${date})`,
        [
          `Filing: Form ${cand.form} filed ${date} (CIK ${cand.cik})`,
          `Issuer: ${form.issuerName} (${issuerState})`,
          `Industry group: ${form.industryGroup !== "" ? form.industryGroup : "unknown"}`,
          `Total offering amount: ${money(form.totalOffering)}`,
          `Amount sold: ${money(form.totalSold)}`,
          `Investors: ${form.investors !== "" ? form.investors : "unknown"}`,
          xmlUrl,
        ].join("\n"),
        sourceIds,
      );
      await writeExtract(
        ctx,
        "sec_form_d",
        "decisions/form-d-filing.md",
        `Form D filing (${date})`,
        `Raised ${money(form.totalSold)} of ${money(form.totalOffering)} on ${date} per Form D (${form.issuerName}). ${xmlUrl}`,
        sourceIds,
      );
      const sold = Number(form.totalSold);
      const offering = Number(form.totalOffering);
      const amount = Number.isFinite(sold) && sold > 0 ? sold : Number.isFinite(offering) ? offering : null;
      const recordItems: UpsertRecordItem[] = [];
      if (/^\d{4}-\d{2}-\d{2}$/.test(cand.fileDate)) {
        recordItems.push({
          type: "funding_event",
          data: {
            date: cand.fileDate,
            ...(amount !== null ? { amount, currency: "USD" } : {}),
            round: "Form D",
            filing_url: xmlUrl,
          },
          sourceIds,
        });
      }
      await writeRecords(ctx, "sec_form_d", recordItems);
      const factItems: AddFactItem[] = [];
      if (/^\d{4}-\d{2}-\d{2}$/.test(cand.fileDate)) {
        factItems.push({
          key: "financials.last_raise_date",
          value: cand.fileDate,
          sourceIds,
          confidence: "high",
        });
      }
      await writeFacts(ctx, "sec_form_d", factItems);
      return {
        outcomes: [
          { area: "financials", status: "done" as const },
          { area: "decisions", status: "done" as const },
        ],
      };
    }

    const lines = ["Form D candidates (no confident match):", ""];
    if (candidates.length === 0) {
      lines.push("- none");
    } else {
      for (const c of candidates.slice(0, 10)) {
        lines.push(`- ${c.name} — Form ${c.form}, filed ${c.fileDate || "unknown"} (CIK ${c.cik})`);
      }
    }
    if (companyState === "") lines.push("", "Company state unknown, so the issuer-state check cannot pass.");
    await writeExtract(ctx, "sec_form_d", "financials/form-d-candidates.md", "Form D candidates", lines.join("\n"), [
      res.source.id,
    ]);
    const reason = "no confident match";
    return {
      outcomes: [
        { area: "financials", status: "not_found" as const, reason },
        { area: "decisions", status: "not_found" as const, reason },
      ],
    };
  },
};
