import type { AddFactItem } from "../../domain/research/facts.js";
import type { Collector, CollectorCtx } from "./types.js";
import { collectFetch, fetchFailure, normalizeName, writeExtract, writeFacts } from "./util.js";

// Companies House Public Data API: GET https://api.company-information.service.gov.uk/search/companies
// ?q=...&items_per_page=20 (HTTP Basic, API key as username, empty password), then
// /company/{number}, /company/{number}/officers, /company/{number}/filing-history
// (https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference/search/search-companies).

// The search returns up to 20 candidates; every one is profile-checked.
// Crowded names need the full list (Stage 5.3 root cause 3).
const CH_MAX_PROFILES = 20;

interface ChCandidate {
  number: string;
  title: string;
  website: string;
}

interface ChProfile {
  name: string;
  number: string;
  status: string;
  incorporated: string;
  sicCodes: string[];
  postcode: string;
  addressLines: string[];
}

function isUK(country: string | null): boolean {
  if (!country) return false;
  const c = country.trim().toLowerCase();
  return c === "united kingdom" || c === "uk" || c === "gb" || c === "great britain";
}

function normalizePostcode(pc: string): string {
  return pc.trim().toUpperCase().replace(/\s+/g, "");
}

function parseSearch(text: string): ChCandidate[] {
  const parsed = JSON.parse(text) as {
    items?: { company_number?: string; title?: string; website?: string }[];
  };
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const out: ChCandidate[] = [];
  for (const item of items) {
    if (item?.company_number && item?.title) {
      out.push({
        number: item.company_number,
        title: item.title,
        website: typeof item.website === "string" ? item.website : "",
      });
    }
  }
  return out;
}

function domainOf(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0] ?? "";
}

export interface AccountsFigures {
  totalAssets: number | null;
  cash: number | null;
  netAssets: number | null;
  employees: number | null;
}

/** Parse the balance-sheet lines out of an iXBRL accounts document. */
export function parseAccountsXhtml(text: string): AccountsFigures {
  const out: AccountsFigures = { totalAssets: null, cash: null, netAssets: null, employees: null };
  const re = /name="([^"]+)"([^>]*)>([^<]+)</g;
  for (const m of text.matchAll(re)) {
    const name = (m[1] ?? "").split(":").pop() ?? "";
    const attrs = m[2] ?? "";
    const raw = (m[3] ?? "").replace(/,/g, "").trim();
    const num = Number(raw);
    if (!Number.isFinite(num) || raw === "") continue;
    const scaleMatch = /scale="(-?\d+)"/.exec(attrs);
    const scale = scaleMatch ? Number(scaleMatch[1]) : 0;
    const sign = /sign="-"/.test(attrs) ? -1 : 1;
    const value = num * 10 ** scale * sign;
    if (name === "TotalAssetsLessCurrentLiabilities" || name === "TotalAssets") out.totalAssets = value;
    else if (name === "CashBankInHand" || name === "CashBankOnHand") out.cash = value;
    else if (name.startsWith("NetAssetsLiabilities") || name === "NetAssets") out.netAssets = value;
    else if (name === "AverageNumberEmployeesDuringPeriod") out.employees = value;
  }
  return out;
}

function parseProfile(text: string): ChProfile | null {
  const p = JSON.parse(text) as Record<string, unknown>;
  if (typeof p["company_number"] !== "string") return null;
  const addr = (p["registered_office_address"] ?? {}) as Record<string, unknown>;
  const lines = [
    addr["address_line_1"],
    addr["address_line_2"],
    addr["locality"],
    addr["region"],
    addr["postal_code"],
  ].filter((v): v is string => typeof v === "string" && v !== "");
  return {
    name: typeof p["company_name"] === "string" ? (p["company_name"] as string) : "",
    number: p["company_number"] as string,
    status: typeof p["company_status"] === "string" ? (p["company_status"] as string) : "",
    incorporated: typeof p["date_of_creation"] === "string" ? (p["date_of_creation"] as string) : "",
    sicCodes: Array.isArray(p["sic_codes"]) ? (p["sic_codes"] as string[]).map(String) : [],
    postcode: typeof addr["postal_code"] === "string" ? (addr["postal_code"] as string) : "",
    addressLines: lines,
  };
}

export const companiesHouseCollector: Collector = {
  name: "companies_house",
  areas: ["financials"],
  run: async (ctx: CollectorCtx) => {
    if (!isUK(ctx.effective.country)) {
      return {
        outcomes: [
          {
            area: "financials",
            status: "skipped" as const,
            reason: `non-UK company (${ctx.effective.country ?? "country unknown"})`,
          },
        ],
      };
    }
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY?.trim() ?? "";
    if (apiKey === "") {
      return {
        outcomes: [
          { area: "financials", status: "skipped" as const, reason: "COMPANIES_HOUSE_API_KEY not set" },
        ],
      };
    }
    const name = ctx.effective.name?.trim() ?? "";
    if (name === "") {
      return {
        outcomes: [{ area: "financials", status: "not_found" as const, reason: "no company name to search" }],
      };
    }
    const auth = { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };
    const searchUrl = `${ctx.endpoints.companiesHouse}/search/companies?q=${encodeURIComponent(name)}&items_per_page=20`;
    const res = await collectFetch(ctx, "companies_house", searchUrl, {
      accept: "application/json",
      headers: auth,
    });
    if (res.source.status !== "ok" || !res.text) {
      const status =
        res.source.status === "blocked" || res.source.status === "robots_disallowed"
          ? ("blocked" as const)
          : res.source.status === "error"
            ? ("error" as const)
            : ("not_found" as const);
      return {
        outcomes: [{ area: "financials", status, reason: `Companies House search: ${fetchFailure(res)}` }],
      };
    }
    let candidates: ChCandidate[];
    try {
      candidates = parseSearch(res.text);
    } catch {
      return {
        outcomes: [
          { area: "financials", status: "error" as const, reason: "Companies House search returned invalid JSON" },
        ],
      };
    }
    const wanted = normalizeName(name);
    const wantedPostcode = ctx.effective.postalCode ? normalizePostcode(ctx.effective.postalCode) : "";
    const wantedDomain = domainOf(ctx.effective.domain ?? ctx.effective.website ?? "");
    const sourceIds = [res.source.id];
    // Score every candidate: website/domain first, then registered name,
    // then postcode. A tie at the top means no confident match.
    interface Scored {
      cand: ChCandidate;
      profile: ChProfile;
      score: [number, number, number];
      sourceId: string;
    }
    const scored: Scored[] = [];
    for (const cand of candidates.slice(0, CH_MAX_PROFILES)) {
      const profileUrl = `${ctx.endpoints.companiesHouse}/company/${cand.number}`;
      const profileRes = await collectFetch(ctx, "companies_house", profileUrl, {
        accept: "application/json",
        headers: auth,
      });
      if (profileRes.source.status !== "ok" || !profileRes.text) continue;
      let profile: ChProfile | null = null;
      try {
        profile = parseProfile(profileRes.text);
      } catch {
        continue;
      }
      if (!profile) continue;
      const domainMatch =
        wantedDomain !== "" && cand.website !== "" && domainOf(cand.website) === wantedDomain ? 1 : 0;
      const nameMatch = profile.name !== "" && normalizeName(profile.name) === wanted ? 1 : 0;
      const postcodeMatch =
        wantedPostcode !== "" &&
        profile.postcode !== "" &&
        normalizePostcode(profile.postcode) === wantedPostcode
          ? 1
          : 0;
      if (domainMatch + nameMatch + postcodeMatch === 0) continue;
      scored.push({ cand, profile, score: [domainMatch, nameMatch, postcodeMatch], sourceId: profileRes.source.id });
    }
    scored.sort(
      (a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || b.score[2] - a.score[2],
    );
    const top = scored[0];
    const tied =
      top !== undefined &&
      scored.filter(
        (s) => s.score[0] === top.score[0] && s.score[1] === top.score[1] && s.score[2] === top.score[2],
      ).length > 1;
    if (top && !tied) {
      const { cand, profile } = top;
      sourceIds.push(top.sourceId);

      let officersCount = "unknown";
      const officersRes = await collectFetch(
        ctx,
        "companies_house",
        `${ctx.endpoints.companiesHouse}/company/${cand.number}/officers?items_per_page=1`,
        { accept: "application/json", headers: auth },
      );
      if (officersRes.source.status === "ok" && officersRes.text) {
        sourceIds.push(officersRes.source.id);
        try {
          const parsed = JSON.parse(officersRes.text) as { total_results?: number };
          if (typeof parsed?.total_results === "number") officersCount = String(parsed.total_results);
        } catch {
          // keep unknown
        }
      }
      let accounts = "none found";
      let accountsType: string | null = null;
      let accountsDate: string | null = null;
      let figures: AccountsFigures | null = null;
      const filingsRes = await collectFetch(
        ctx,
        "companies_house",
        `${ctx.endpoints.companiesHouse}/company/${cand.number}/filing-history?items_per_page=10`,
        { accept: "application/json", headers: auth },
      );
      if (filingsRes.source.status === "ok" && filingsRes.text) {
        sourceIds.push(filingsRes.source.id);
        try {
          const parsed = JSON.parse(filingsRes.text) as {
            items?: {
              category?: string;
              date?: string;
              type?: string;
              description?: string;
              links?: { document_metadata?: string };
            }[];
          };
          const items = Array.isArray(parsed?.items) ? parsed.items : [];
          const acct = items.find((i) => i?.category === "accounts");
          if (acct) {
            accounts = `${acct.date ?? "date unknown"} (${acct.type ?? acct.description ?? "accounts"})`;
            accountsType = acct.type ?? acct.description ?? null;
            accountsDate = acct.date ?? null;
            const metaLink = acct.links?.document_metadata;
            if (metaLink) {
              const metaUrl = metaLink.startsWith("http")
                ? metaLink
                : `${ctx.endpoints.companiesHouse}${metaLink}`;
              const metaRes = await collectFetch(ctx, "companies_house", metaUrl, {
                accept: "application/json",
                headers: auth,
              });
              if (metaRes.source.status === "ok" && metaRes.text) {
                sourceIds.push(metaRes.source.id);
                try {
                  const meta = JSON.parse(metaRes.text) as { links?: { document?: string } };
                  const docLink = meta.links?.document;
                  if (docLink) {
                    const docUrl = docLink.startsWith("http")
                      ? docLink
                      : `${ctx.endpoints.companiesHouse}${docLink}`;
                    const docRes = await collectFetch(ctx, "companies_house", docUrl, {
                      accept: "application/xhtml+xml",
                      headers: auth,
                    });
                    if (docRes.source.status === "ok" && docRes.text) {
                      sourceIds.push(docRes.source.id);
                      figures = parseAccountsXhtml(docRes.text);
                    }
                  }
                } catch {
                  // keep figures null
                }
              }
            }
          }
        } catch {
          // keep none found
        }
      }
      await writeExtract(
        ctx,
        "companies_house",
        "financials/companies-house.md",
        `Companies House (${profile.number})`,
        [
          `Company: ${profile.name} (${profile.number})`,
          `Status: ${profile.status !== "" ? profile.status : "unknown"}`,
          `Incorporated: ${profile.incorporated !== "" ? profile.incorporated : "unknown"}`,
          `SIC codes: ${profile.sicCodes.length > 0 ? profile.sicCodes.join(", ") : "none"}`,
          `Registered office: ${profile.addressLines.join(", ") || "unknown"}`,
          `Officers: ${officersCount}`,
          `Latest accounts: ${accounts}`,
        ].join("\n"),
        sourceIds,
      );
      const factItems: AddFactItem[] = [];
      if (accountsType) {
        factItems.push({
          key: "financials.accounts_type",
          value: accountsType,
          sourceIds,
          confidence: "high",
        });
      }
      const foundedYear = /^\d{4}/.exec(profile.incorporated)?.[0];
      if (foundedYear) {
        factItems.push({
          key: "company.founded_year",
          value: Number(foundedYear),
          sourceIds,
          confidence: "high",
        });
      }
      // Latest accounts as dated facts. UK small-company filings hide
      // turnover, so the balance sheet is the financial evidence.
      if (figures && accountsDate) {
        const money = (key: string, amount: number | null) => {
          if (amount !== null) {
            factItems.push({
              key,
              value: { amount, currency: "GBP" },
              asOf: accountsDate,
              sourceIds,
              confidence: "high",
            });
          }
        };
        money("financials.total_assets", figures.totalAssets);
        money("financials.cash", figures.cash);
        money("financials.net_assets", figures.netAssets);
        if (figures.employees !== null) {
          factItems.push({
            key: "financials.employees",
            value: Math.round(figures.employees),
            qualifiers: { source: "companies_house" },
            asOf: accountsDate,
            sourceIds,
            confidence: "high",
          });
        }
      }
      await writeFacts(ctx, "companies_house", factItems);
      return { outcomes: [{ area: "financials", status: "done" as const }] };
    }

    const lines = ["Companies House candidates (no confident match):", ""];
    if (candidates.length === 0) {
      lines.push("- none");
    } else {
      for (const c of candidates.slice(0, CH_MAX_PROFILES)) {
        lines.push(`- ${c.title} (${c.number})`);
      }
    }
    await writeExtract(ctx, "companies_house", "financials/companies-house-candidates.md", "Companies House candidates", lines.join("\n"), [
      res.source.id,
    ]);
    return {
      outcomes: [{ area: "financials", status: "not_found" as const, reason: "no confident match" }],
    };
  },
};
