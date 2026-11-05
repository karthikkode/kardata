import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies } from "../../db/schema.js";
import { companyHomepage, type WebsiteVendorConfig } from "../../collect/collectors/website-software.js";
import { effectiveCompanies } from "../effective.js";

export type WebsiteCompany = { id: string; website: string | null; domain: string | null; sharedDomain: boolean };
export type WebsiteInput = { home: URL | null; kind: "website" | "domain" | null; shared: boolean };
const hostKey = (home: URL) => home.hostname.toLowerCase().replace(/^www\./, "");

/** Use only stored company sites/domains, never guessed domains or alternate fetch routes. */
export function selectWebsiteInputs(directory: WebsiteCompany[], ids: Set<string>, config: WebsiteVendorConfig) {
  const owners = new Map<string, Set<string>>();
  for (const row of directory) for (const value of [row.website, row.domain]) {
    const home = companyHomepage(value, config);
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
  }
  return inputs;
}

export async function websiteInputs(db: Db, ids: string[], config: WebsiteVendorConfig) {
  const effective = effectiveCompanies(db);
  // Ownership spans all companies, including firms outside the selected sector/batch.
  const directory = await db.select({ id: effective.id, website: effective.website,
    domain: effective.domain, sharedDomain: effective.sharedDomain }).from(effective)
    .where(inArray(effective.id, db.select({ id: companies.id }).from(companies).where(eq(companies.evidenceLibrary, false))));
  return selectWebsiteInputs(directory, new Set(ids), config);
}

export function websiteCheckKey(config: WebsiteVendorConfig, input: WebsiteInput) {
  if (input.shared) return null;
  const version = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
  return `${version}:${input.home?.href ?? "missing"}`;
}
