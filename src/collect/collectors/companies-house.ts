import type { AddFactItem } from "../../domain/research/facts.js";
import type { Collector, CollectorCtx } from "./types.js";
import { collectFetch, fetchFailure, normalizeName, writeExtract, writeFacts } from "./util.js";

// Companies House Public Data API: GET https://api.company-information.service.gov.uk/search/companies
// ?q=...&items_per_page=20 (HTTP Basic, API key as username, empty password), then
// /company/{number}, /company/{number}/officers, /company/{number}/filing-history
// (https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/reference/search/search-companies).

const CH_MAX_PROFILES = 3;

interface ChCandidate {
  number: string;
  title: string;
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
  const parsed = JSON.parse(text) as { items?: { company_number?: string; title?: string }[] };
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const out: ChCandidate[] = [];
  for (const item of items) {
    if (item?.company_number && item?.title) {
      out.push({ number: item.company_number, title: item.title });
    }
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
    const sourceIds = [res.source.id];
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
      const nameMatch = profile.name !== "" && normalizeName(profile.name) === wanted;
      const postcodeMatch =
        wantedPostcode !== "" &&
        profile.postcode !== "" &&
        normalizePostcode(profile.postcode) === wantedPostcode;
      if (!nameMatch && !postcodeMatch) continue;
      sourceIds.push(profileRes.source.id);

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
            items?: { category?: string; date?: string; type?: string; description?: string }[];
          };
          const items = Array.isArray(parsed?.items) ? parsed.items : [];
          const acct = items.find((i) => i?.category === "accounts");
          if (acct) {
            accounts = `${acct.date ?? "date unknown"} (${acct.type ?? acct.description ?? "accounts"})`;
            accountsType = acct.type ?? acct.description ?? null;
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
      await writeFacts(ctx, "companies_house", factItems);
      return { outcomes: [{ area: "financials", status: "done" as const }] };
    }

    const lines = ["Companies House candidates (no confident match):", ""];
    if (candidates.length === 0) {
      lines.push("- none");
    } else {
      for (const c of candidates.slice(0, 3)) {
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
