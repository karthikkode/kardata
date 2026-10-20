import type { AddFactItem } from "../../domain/research/facts.js";
import type { Collector, CollectorCtx } from "./types.js";
import { collectFetch, toFetchedPage, writeExtract, writeFacts } from "./util.js";

const REVIEW_MAX_PRODUCT_PAGES = 3;

const REVIEW_APPS: { match: string; name: string }[] = [
  { match: "judge.me", name: "Judge.me" },
  { match: "judgeme", name: "Judge.me" },
  { match: "yotpo", name: "Yotpo" },
  { match: "okendo", name: "Okendo" },
  { match: "stamped", name: "Stamped" },
  { match: "loox", name: "Loox" },
  { match: "reviews.io", name: "Reviews.io" },
  { match: "ratingsandreviews", name: "Reviews.io" },
];

interface AggregateRating {
  value: number;
  count: number | null;
  source: string;
}

function ratingFrom(block: unknown, source: string): AggregateRating | null {
  if (typeof block !== "object" || block === null) return null;
  const record = block as Record<string, unknown>;
  const rating = record["aggregateRating"] as Record<string, unknown> | undefined;
  if (!rating || typeof rating !== "object") return null;
  const value = Number.parseFloat(String(rating["ratingValue"]));
  if (!Number.isFinite(value)) return null;
  const countRaw = rating["reviewCount"] ?? rating["ratingCount"];
  const count = countRaw === undefined ? null : Number.parseInt(String(countRaw), 10);
  return { value, count: count !== null && Number.isFinite(count) ? count : null, source };
}

export const reviewsCollector: Collector = {
  name: "reviews",
  areas: ["reviews"],
  run: async (ctx: CollectorCtx) => {
    const site = ctx.shared.site;
    if (!site?.homepage) {
      return {
        outcomes: [
          {
            area: "reviews",
            status: site?.homepageFailed ? "blocked" : "not_found",
            reason: site?.homepageFailed
              ? `no homepage content: ${site.homepageFailed}`
              : "no homepage content",
          },
        ],
      };
    }
    const ratings: AggregateRating[] = [];
    const sourceIds: string[] = [site.homepage.sourceId];
    for (const block of site.homepage.jsonLd) {
      const r = ratingFrom(block, site.homepage.url);
      if (r) ratings.push(r);
    }
    const scriptHaystacks = [site.homepage.scripts.join("\n").toLowerCase()];

    for (const url of site.productUrls.slice(0, REVIEW_MAX_PRODUCT_PAGES)) {
      const res = await collectFetch(ctx, "reviews", url);
      if (res.source.status !== "ok" || !res.text) continue;
      sourceIds.push(res.source.id);
      const page = toFetchedPage(res.source.url, res.source.finalUrl, res.source.id, res.text);
      for (const block of page.jsonLd) {
        const r = ratingFrom(block, page.url);
        if (r) ratings.push(r);
      }
      scriptHaystacks.push(page.scripts.join("\n").toLowerCase());
    }

    const techHaystack = ctx.effective.technologies.join("\n").toLowerCase();
    const apps = REVIEW_APPS.filter(
      (app) =>
        techHaystack.includes(app.match) || scriptHaystacks.some((h) => h.includes(app.match)),
    ).map((app) => app.name);
    const uniqueApps = [...new Set(apps)];

    if (ratings.length === 0 && uniqueApps.length === 0) {
      return {
        outcomes: [
          { area: "reviews", status: "not_found", reason: "no ratings or review app detected" },
        ],
      };
    }
    const lines = ["Aggregate ratings (JSON-LD):", ""];
    if (ratings.length > 0) {
      for (const r of ratings) {
        lines.push(
          `- ${r.value}${r.count !== null ? ` from ${r.count} reviews` : ""} (${r.source})`,
        );
      }
    } else {
      lines.push("- none found");
    }
    lines.push("", "Review app:", uniqueApps.length > 0 ? `- ${uniqueApps.join(", ")}` : "- none detected");
    await writeExtract(ctx, "reviews", "reviews/ratings.md", "Ratings and review app", lines.join("\n"), sourceIds);
    const platform = uniqueApps.length === 1 ? { platform: uniqueApps[0] as string } : undefined;
    const factItems: AddFactItem[] = [];
    for (const r of ratings) {
      factItems.push({
        key: "reviews.avg_rating",
        value: r.value,
        ...(platform ? { qualifiers: platform } : {}),
        sourceIds,
        confidence: "high",
      });
      if (r.count !== null) {
        factItems.push({
          key: "reviews.count",
          value: r.count,
          ...(platform ? { qualifiers: platform } : {}),
          sourceIds,
          confidence: "high",
        });
      }
    }
    for (const app of uniqueApps) {
      factItems.push({ key: "reviews.app", value: app, sourceIds, confidence: "high" });
    }
    await writeFacts(ctx, "reviews", factItems);
    return { outcomes: [{ area: "reviews", status: "done" }] };
  },
};
