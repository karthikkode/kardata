import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, facts, records } from "../../db/schema.js";
import { companyHomepage, type WebsiteVendorConfig } from "../../collect/collectors/website-software.js";
import { effectiveCompanies } from "../effective.js";
import { FILED_WEBSITE_COLLECTOR, FILED_WEBSITE_KEY, websiteHost } from "./website-address.js";

export type WebsiteCompany = { id: string; website: string | null; domain: string | null; sharedDomain: boolean;
  filedWebsite?: string | null; filedClaims?: string[] };
export type WebsiteInput = { home: URL | null; kind: "website" | "domain" | "filed" | null; shared: boolean };
const hostKey = websiteHost;

/** Use only stored company sites/domains, never guessed domains or alternate fetch routes. */
export function selectWebsiteInputs(directory: WebsiteCompany[], ids: Set<string>, config: WebsiteVendorConfig) {
  const owners = new Map<string, Set<string>>();
  for (const row of directory) for (const value of [row.website, row.domain, row.filedWebsite, ...row.filedClaims ?? []]) {
    const home = companyHomepage(value ?? null, config);
    if (!home) continue;
    const key = hostKey(home);
    const claims = owners.get(key) ?? new Set<string>();
    claims.add(row.id);
    owners.set(key, claims);
  }
  const inputs = new Map<string, WebsiteInput>();
  for (const row of directory) {
    if (!ids.has(row.id)) continue;
    const site = companyHomepage(row.website, config);
    const domain = companyHomepage(row.domain, config);
    const home = site ?? domain;
    const shared = (!site && row.sharedDomain) || (!!home && ((owners.get(hostKey(home))?.size ?? 0) > 1 ||
      (row.sharedDomain && !!domain && hostKey(domain) === hostKey(home))));
    inputs.set(row.id, { home, kind: site ? "website" : domain ? "domain" : null, shared });
    if (!home || shared) {
      const filed = companyHomepage(row.filedWebsite ?? null, config);
      const flagged = filed && row.sharedDomain && domain && hostKey(domain) === hostKey(filed);
      if (filed && !flagged && owners.get(hostKey(filed))?.size === 1) inputs.set(row.id, { home: filed, kind: "filed", shared: false });
    }
  }
  return inputs;
}

export async function websiteInputs(db: Db, ids: string[], config: WebsiteVendorConfig) {
  const effective = effectiveCompanies(db);
  // Ownership spans all companies, including firms outside the selected sector/batch.
  const directory = await db.select({ id: effective.id, website: effective.website,
    domain: effective.domain, sharedDomain: effective.sharedDomain }).from(effective)
    .where(inArray(effective.id, db.select({ id: companies.id }).from(companies).where(eq(companies.evidenceLibrary, false))));
  const filed = await db.selectDistinctOn([facts.companyId]).from(facts).where(and(eq(facts.key, FILED_WEBSITE_KEY),
    eq(facts.createdBy, FILED_WEBSITE_COLLECTOR))).orderBy(facts.companyId, desc(facts.asOf), desc(facts.createdAt), desc(facts.id));
  const byCompany = new Map(filed.map(row => {
    const value = row.valueJson as { url?: unknown } | null;
    return [row.companyId, typeof value?.url === "string" ? value.url : null];
  }));
  const claims = await db.select({ companyId: records.companyId, data: records.data }).from(records).where(eq(records.type, "sec_adv_schedules"));
  const claimed = new Map<string, string[]>();
  for (const row of claims) if (Array.isArray(row.data.websites)) claimed.set(row.companyId,
    [...claimed.get(row.companyId) ?? [], ...row.data.websites.filter((v): v is string => typeof v === "string")]);
  return selectWebsiteInputs(directory.map(row => ({ ...row, filedWebsite: byCompany.get(row.id), filedClaims: claimed.get(row.id) })), new Set(ids), config);
}

export function websiteCheckKey(config: WebsiteVendorConfig, input: WebsiteInput) {
  if (input.shared) return null;
  const version = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
  return `${version}:${input.home?.href ?? "missing"}`;
}
