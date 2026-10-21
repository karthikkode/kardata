import { and, eq, or } from "drizzle-orm";
import { facts, records, sources } from "../../db/schema.js";
import { reviewsIngest, type IngestReview } from "../../domain/research/reviews.js";
import { recordEvent } from "../db.js";
import {
  REVIEWS_JOB_MAX_PAGES,
  REVIEWS_JOB_MAX_REVIEWS,
  dockerReviewsJob,
  type ReviewsJobOutput,
  type ReviewsJobPage,
  type ReviewsJobRunner,
} from "../../harness/reviews.js";
import type { Collector, CollectorCtx, CollectorResult } from "./types.js";
import { collectFetch } from "./util.js";

// reviews.app values (lowercased) that the on-site job can parse.
const SUPPORTED_APPS: Record<string, { vendor: string; platform: string }> = {
  "judge.me": { vendor: "judgeme", platform: "Judge.me" },
  judgeme: { vendor: "judgeme", platform: "Judge.me" },
  yotpo: { vendor: "yotpo", platform: "Yotpo" },
  stamped: { vendor: "stamped", platform: "Stamped" },
  okendo: { vendor: "okendo", platform: "Okendo" },
  loox: { vendor: "loox", platform: "Loox" },
  junip: { vendor: "junip", platform: "Junip" },
  "reviews.io": { vendor: "reviewsio", platform: "Reviews.io" },
};

const HERO_TAGS = ["bestseller", "best-seller", "best seller", "hero", "featured", "top rated", "top-rated"];

function isOwnDomain(rawUrl: string, domain: string | null): boolean {
  if (!domain) return false;
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const apex = domain.toLowerCase().replace(/^www\./, "");
  const bare = host.replace(/^www\./, "");
  return bare === apex || bare.endsWith(`.${apex}`);
}

function isHero(data: Record<string, unknown>): boolean {
  const tags = Array.isArray(data["tags"]) ? (data["tags"] as unknown[]).map((t) => String(t).toLowerCase()) : [];
  return tags.some((t) => HERO_TAGS.some((h) => t.includes(h)));
}

interface ProductPage extends ReviewsJobPage {
  sourceId: string;
}

export async function pickProductPages(
  ctx: CollectorCtx,
  productUrls: { url: string; name: string; hero: boolean }[],
): Promise<ProductPage[]> {
  const domain = ctx.effective.domain ?? ctx.company.domain ?? null;
  const seen = new Set<string>();
  const hero: typeof productUrls = [];
  const rest: typeof productUrls = [];
  for (const p of productUrls) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    if (!isOwnDomain(p.url, domain)) continue;
    (p.hero ? hero : rest).push(p);
  }
  // collectFetch is the robots pre-check: disallowed URLs come back without
  // text and never reach the browser job.
  const picked: ProductPage[] = [];
  for (const p of [...hero, ...rest].slice(0, REVIEWS_JOB_MAX_PAGES)) {
    const res = await collectFetch(ctx, "reviews_onsite", p.url);
    if (res.source.status !== "ok" || !res.text) continue;
    picked.push({ url: res.source.finalUrl, product: p.name, sourceId: res.source.id });
  }
  return picked;
}

function toIngestReviews(output: ReviewsJobOutput, pageUrl: string): IngestReview[] {
  return output.reviews
    .filter((r) => r.url === undefined || r.url === pageUrl)
    .map((r) => ({
      text: r.text,
      ...(r.rating !== undefined ? { rating: r.rating } : {}),
      ...(r.rating_scale !== undefined ? { rating_scale: r.rating_scale } : {}),
      ...(r.title !== undefined ? { title: r.title } : {}),
      ...(r.date !== undefined ? { date: r.date } : {}),
      ...(r.product !== undefined ? { product: r.product } : {}),
      ...(r.verified_buyer !== undefined ? { verified_buyer: r.verified_buyer } : {}),
      ...(r.url !== undefined ? { url: r.url } : {}),
    }));
}

export async function runReviewsOnsite(
  ctx: CollectorCtx,
  runner: ReviewsJobRunner = dockerReviewsJob,
): Promise<CollectorResult> {
  if (!ctx.shared.shopify?.isShopify) {
    return { outcomes: [{ area: "reviews", status: "skipped", reason: "not a Shopify store" }] };
  }
  const appFacts = await ctx.db
    .select({ valueText: facts.valueText })
    .from(facts)
    .where(and(eq(facts.companyId, ctx.companyId), eq(facts.runId, ctx.runId), eq(facts.key, "reviews.app")));
  const apps = [...new Set(appFacts.map((f) => (f.valueText ?? "").trim()).filter((v) => v !== ""))];
  if (apps.length === 0) {
    return { outcomes: [{ area: "reviews", status: "skipped", reason: "no review app detected" }] };
  }
  const supported = apps.map((a) => SUPPORTED_APPS[a.toLowerCase()]).find((s) => s !== undefined);
  if (!supported) {
    return {
      outcomes: [{ area: "reviews", status: "not_found", reason: `unsupported review app: ${apps.join(", ")}` }],
    };
  }
  const productRows = await ctx.db
    .select({ data: records.data })
    .from(records)
    .where(
      and(
        eq(records.companyId, ctx.companyId),
        eq(records.type, "product"),
        or(eq(records.firstSeenRunId, ctx.runId), eq(records.lastSeenRunId, ctx.runId)),
      ),
    );
  const candidates = productRows.flatMap((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const url = typeof data["url"] === "string" ? data["url"] : "";
    if (url === "") return [];
    return [{ url, name: typeof data["name"] === "string" ? (data["name"] as string) : url, hero: isHero(data) }];
  });
  if (candidates.length === 0) {
    return { outcomes: [{ area: "reviews", status: "not_found", reason: "no product pages collected" }] };
  }
  const pages = await pickProductPages(ctx, candidates);
  if (pages.length === 0) {
    return {
      outcomes: [{ area: "reviews", status: "blocked", reason: "every product page failed or was robots-disallowed" }],
    };
  }
  let output: ReviewsJobOutput;
  try {
    output = await runner({ runId: ctx.runId, pages, maxReviews: REVIEWS_JOB_MAX_REVIEWS });
  } catch (err) {
    return {
      outcomes: [
        {
          area: "reviews",
          status: "error",
          reason: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        },
      ],
    };
  }
  let ingested = 0;
  const vendors = new Set<string>();
  const pageTotals: { url: string; displayed: number | null; ingested: number }[] = [];
  for (const page of pages) {
    const reported = output.pages.find((p) => p.url === page.url);
    const displayed = reported?.displayedTotal ?? null;
    const items = toIngestReviews(output, page.url).slice(0, REVIEWS_JOB_MAX_REVIEWS - ingested);
    if (items.length === 0) {
      pageTotals.push({ url: page.url, displayed, ingested: 0 });
      continue;
    }
    if (reported?.vendor) vendors.add(reported.vendor);
    const result = await reviewsIngest(ctx.db, {
      companyId: ctx.companyId,
      runId: ctx.runId,
      platform: supported.platform,
      sourceId: page.sourceId,
      reviews: items,
      createdBy: "collector:reviews_onsite",
    });
    const pageIngested = result.results.filter((r) => r.ok).length;
    ingested += pageIngested;
    pageTotals.push({ url: page.url, displayed, ingested: pageIngested });
    await ctx.db
      .update(sources)
      .set({ details: { displayedTotal: displayed, ingestedOnPage: pageIngested } })
      .where(eq(sources.id, page.sourceId));
  }
  const knownTotals = pageTotals.filter((p) => p.displayed !== null);
  const displayed = knownTotals.length === 0 ? null : knownTotals.reduce((a, p) => a + (p.displayed ?? 0), 0);
  await recordEvent(ctx.db, ctx.runId, "log", {
    reviews_onsite: {
      pages: output.pages.map((p) => ({
        url: p.url,
        vendor: p.vendor,
        status: p.status,
        reason: p.reason ?? null,
        reviewCount: p.reviewCount,
        displayedTotal: p.displayedTotal ?? null,
      })),
      ingested,
      displayed,
    },
  });
  if (ingested === 0) {
    const detected = output.pages.map((p) => p.vendor).find((v) => v !== null && v !== undefined);
    return {
      outcomes: [
        {
          area: "reviews",
          status: "not_found",
          reason: detected ? `no reviews parsed (detected vendor: ${detected})` : "no widget or JSON-LD reviews found",
        },
      ],
    };
  }
  return {
    outcomes: [
      {
        area: "reviews",
        status: "done",
        reason:
          displayed === null
            ? `${ingested} reviews from ${pages.length} pages (${supported.platform})`
            : `${ingested} of ${displayed} displayed reviews from ${pages.length} pages (${supported.platform})`,
      },
    ],
  };
}

export const reviewsOnsiteCollector: Collector = {
  name: "reviews_onsite",
  areas: ["reviews"],
  run: async (ctx) => runReviewsOnsite(ctx),
};
