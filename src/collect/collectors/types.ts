import type { Db } from "../../db/client.js";
import type { Area, Company, Source } from "../../db/schema.js";
import type { EffectiveCompany } from "../../domain/companies.js";

export type { Area };

// Base URLs for every host a collect run may touch. Production uses
// DEFAULT_ENDPOINTS; tests point each one at the fake site.
export interface CollectEndpoints {
  gdelt: string;
  secEfts: string;
  secData: string;
  cdx: string;
  wayback: string;
  greenhouse: string;
  lever: string;
  ashby: string;
  workable: string;
  companiesHouse: string;
}

export const DEFAULT_ENDPOINTS: CollectEndpoints = {
  gdelt: "https://api.gdeltproject.org",
  secEfts: "https://efts.sec.gov",
  secData: "https://www.sec.gov",
  cdx: "https://web.archive.org",
  wayback: "https://web.archive.org",
  greenhouse: "https://boards-api.greenhouse.io",
  lever: "https://api.lever.co",
  ashby: "https://api.ashbyhq.com",
  workable: "https://apply.workable.com",
  companiesHouse: "https://api.company-information.service.gov.uk",
};

export interface CollectorOptions {
  endpoints?: Partial<CollectEndpoints>;
  privateHostAllowlist?: string[];
}

export interface PageLink {
  href: string;
  text: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  sourceId: string;
  title: string;
  html: string;
  text: string;
  links: PageLink[];
  scripts: string[];
  jsonLd: unknown[];
}

// What the site collector stashed for later collectors.
export interface SiteShared {
  homepage?: FetchedPage;
  homepageFailed?: string;
  // Classified pages in fetch order: [class, page].
  pages: { class: string; page: FetchedPage }[];
  // Candidate product-page URLs from the sitemap, in sitemap order.
  productUrls: string[];
  sitemapUrls: string[];
  socialLinks: PageLink[];
}

export interface ShopifyProduct {
  id: number | string;
  title: string;
  productType: string;
  tags: string[];
  createdAt: string | null;
  publishedAt: string | null;
  handle: string;
  variants: { price: string | number | null }[];
}

export interface ShopifyShared {
  checked: boolean;
  isShopify: boolean;
  products: ShopifyProduct[];
  collections: string[];
  productsUrl: string | null;
}

export interface RunShared {
  site?: SiteShared;
  shopify?: ShopifyShared;
}

export interface CollectorCtx {
  db: Db;
  runId: string;
  companyId: string;
  company: Company;
  effective: EffectiveCompany;
  endpoints: CollectEndpoints;
  privateHostAllowlist: string[];
  shared: RunShared;
}

export type AreaOutcomeStatus = "done" | "not_found" | "blocked" | "error" | "skipped";

export interface AreaOutcome {
  area: Area;
  status: AreaOutcomeStatus;
  reason?: string;
}

export interface CollectorResult {
  outcomes: AreaOutcome[];
  // Set when the run cannot meaningfully continue (homepage fetch failed).
  fatal?: string;
}

export interface Collector {
  name: string;
  areas: Area[];
  run: (ctx: CollectorCtx) => Promise<CollectorResult>;
}

export function okSource(source: Source): boolean {
  return source.status === "ok";
}
