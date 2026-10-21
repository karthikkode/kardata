import { COLLECTORS } from "./collectors/index.js";
import type {
  Area,
  AreaOutcome,
  Collector,
  CollectorCtx,
  CollectorResult,
} from "./collectors/types.js";

/**
 * Source adapters (Stage 5 Phase 5): the versioned, onboarding-gated face of
 * collectors. Collect runs execute adapters, never collectors directly; new
 * sources onboard only through this registry (docs/sources/onboarding.md).
 */

export interface AdapterDetect {
  applies: boolean;
  reason?: string;
}

export interface SourceAdapter {
  id: string;
  /** Semver; bump when the adapter's behavior changes. */
  version: string;
  areas: Area[];
  blurb: string;
  /**
   * Cheap pre-check (no network of its own). Absent means always attempt;
   * a false verdict skips the run with not_found outcomes.
   */
  detect?: (ctx: CollectorCtx) => Promise<AdapterDetect>;
  collect: (ctx: CollectorCtx) => Promise<CollectorResult>;
}

const ADAPTER_VERSION = "1.0.0";

const BLURBS: Record<string, string> = {
  site: "company website crawl",
  shopify: "storefront products + theme",
  jobs: "job-board postings",
  reviews: "third-party review platforms",
  reviews_onsite: "on-site review widget",
  stack: "Apollo technology mapping",
  feeds: "RSS/Atom feeds",
  news: "GDELT news search",
  sec_form_d: "SEC Form D filings",
  wayback: "Internet Archive snapshots",
  companies_house: "UK company registry",
  apollo_profile: "Apollo firmographics",
};

function toAdapter(collector: Collector): SourceAdapter {
  const blurb = BLURBS[collector.name];
  if (!blurb) throw new Error(`adapter "${collector.name}" is missing a blurb`);
  return {
    id: collector.name,
    version: ADAPTER_VERSION,
    areas: [...collector.areas],
    blurb,
    collect: (ctx) => collector.run(ctx),
  };
}

export const ADAPTERS: SourceAdapter[] = COLLECTORS.map(toAdapter);

export function getAdapter(id: string): SourceAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}

/** Resolve a preflight plan to adapters, in plan order. Unknown ids are reported, never improvised. */
export function resolvePlanAdapters(ids: string[]): { adapters: SourceAdapter[]; unknown: string[] } {
  const adapters: SourceAdapter[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const adapter = getAdapter(id);
    if (adapter) adapters.push(adapter);
    else unknown.push(id);
  }
  return { adapters, unknown };
}

/** not_found outcomes for every area an adapter covers (detect skip). */
export function skippedOutcomes(adapter: Pick<SourceAdapter, "areas">, reason: string): AreaOutcome[] {
  return adapter.areas.map((area) => ({ area, status: "not_found" as const, reason }));
}
