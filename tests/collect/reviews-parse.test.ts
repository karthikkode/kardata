import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectFramesReviews,
  collectPageReviews,
  detectVendor,
  findNextPageNumber,
  parseAccessibleReviewCards,
  parseDisplayedTotal,
  parseJsonLdAggregateCount,
  parseJsonLdReviews,
  parseWidgetReviews,
} from "../../harness/reviews.mjs";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "..", "fixtures", "reviews", name), "utf8");
}

describe("detectVendor", () => {
  it("detects Judge.me, Stamped and Yotpo pages", () => {
    expect(detectVendor(fixture("judgeme.html")).vendor).toBe("judgeme");
    expect(detectVendor(fixture("stamped.html")).vendor).toBe("stamped");
    expect(detectVendor(fixture("yotpo.html")).vendor).toBe("yotpo");
  });

  it("finds no widget on the JSON-LD-only page", () => {
    expect(detectVendor(fixture("jsonld.html")).vendor).toBeNull();
  });

  it("detects Okendo Reviews Widget Plus nodes", () => {
    const found = detectVendor(fixture("okendo-plus.html"));
    expect(found.vendor).toBe("okendo");
    expect(found.dom).toBe(true);
  });

  it("marks script-only matches as no widget DOM", () => {
    // Loyalty integrations ship vendor scripts without a reviews widget.
    const found = detectVendor(
      `<html><head><script src="https://cdn-widgetsrepository.yotpo.com/loyalty.js"></script></head><body><p>no reviews here</p></body></html>`,
    );
    expect(found.vendor).toBe("yotpo");
    expect(found.dom).toBe(false);
  });
});

describe("parseWidgetReviews", () => {
  it("parses Judge.me reviews, ratings and verified flags", () => {
    const reviews = parseWidgetReviews(fixture("judgeme.html"), "judgeme");
    expect(reviews).toHaveLength(3);
    expect(reviews[0]).toMatchObject({
      title: "Cleared my breakouts",
      rating: 5,
      rating_scale: 5,
      date: "2026-09-14",
      verified_buyer: true,
    });
    expect(reviews[0]?.text).toContain("cystic spots");
    expect(reviews[1]).toMatchObject({ rating: 4, date: "10/02/2026" });
    expect(reviews[1]).not.toHaveProperty("verified_buyer");
    // No data-score: falls back to counting filled stars.
    expect(reviews[2]).toMatchObject({ rating: 3 });
    expect(reviews[2]).not.toHaveProperty("title");
  });

  it("parses Stamped reviews via data-rating", () => {
    const reviews = parseWidgetReviews(fixture("stamped.html"), "stamped");
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      title: "Holy grail serum",
      rating: 5,
      date: "2026-07-20",
      verified_buyer: true,
    });
    expect(reviews[1]).toMatchObject({ rating: 2, date: "June 11, 2026" });
  });

  it("parses Yotpo reviews, skipping empty stars", () => {
    const reviews = parseWidgetReviews(fixture("yotpo.html"), "yotpo");
    expect(reviews).toHaveLength(3);
    expect(reviews[0]).toMatchObject({
      title: "Pores look smaller",
      rating: 5,
      date: "2026-05-30",
      verified_buyer: true,
    });
    expect(reviews[1]).toMatchObject({ rating: 3, date: "04/18/2026" });
    expect(reviews[2]).toMatchObject({
      title: "New layout title",
      rating: 5,
      date: "12/01/25",
      verified_buyer: true,
    });
  });

  it("parses Yotpo review-card layout with clean dates", () => {
    const reviews = parseWidgetReviews(fixture("yotpo-card.html"), "yotpo");
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      title: "Gentle and effective",
      date: "01/02/26",
      verified_buyer: true,
    });
    expect(reviews[0]?.text).toContain("holy grail");
    // No nested date child: the "Published date" label is stripped.
    expect(reviews[1]).toMatchObject({ date: "02/14/26" });
    expect(reviews[1]).not.toHaveProperty("verified_buyer");
  });

  it("parses Okendo Reviews Widget Plus cards", () => {
    const reviews = parseWidgetReviews(fixture("okendo-plus.html"), "okendo");
    expect(reviews).toHaveLength(5);
    expect(reviews[0]).toMatchObject({
      title: "Visible firmness",
      rating: 5,
      rating_scale: 5,
      date: "2026-08-02",
      verified_buyer: true,
    });
    expect(reviews[0]?.text).toContain("test fine lines");
    expect(reviews[1]).toMatchObject({ rating: 3, date: "2 months ago" });
    expect(reviews[1]).not.toHaveProperty("title");
    expect(reviews[1]).not.toHaveProperty("verified_buyer");
    // Featured-media layout: same fields, nested structural nodes deduped.
    expect(reviews[2]).toMatchObject({
      title: "Staple scrub",
      rating: 4,
      date: "1 week ago",
      verified_buyer: true,
    });
    expect(reviews[2]?.text).toContain("synthetic exfoliating beads");
    // Side layout shares the same inner fields.
    expect(reviews[3]).toMatchObject({
      title: "Morning staple",
      rating: 5,
      date: "Yesterday",
      verified_buyer: true,
    });
    expect(reviews[3]?.text).toContain("layers quietly");
    // Minimal layout: own date node, shared inner fields.
    expect(reviews[4]).toMatchObject({
      title: "Gentle giant",
      rating: 5,
      date: "3 days ago",
      verified_buyer: true,
    });
    expect(reviews[4]?.text).toContain("survived months of test bedside use");
  });

  it("parses legacy Okendo cards with attribute dates", () => {
    const reviews = parseWidgetReviews(fixture("okendo-legacy.html"), "okendo");
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      title: "Handbag essential",
      rating: 5,
      date: "2026-05-11T10:00:00.000Z",
      verified_buyer: true,
    });
    expect(reviews[0]?.text).toContain("survived a week of test travel");
    expect(reviews[1]).toMatchObject({ rating: 2, date: "2026-04-02T10:00:00.000Z" });
    expect(reviews[1]).not.toHaveProperty("title");
    expect(reviews[1]).not.toHaveProperty("verified_buyer");
  });

  it("parses Loox grid cards from iframe HTML", () => {
    const reviews = parseWidgetReviews(fixture("loox-frame.html"), "loox");
    expect(reviews).toHaveLength(2);
    // Grid cards carry no title; .block.title is the reviewer name (identity).
    expect(reviews[0]).toMatchObject({ rating: 5, date: "2026-07-19", verified_buyer: true });
    expect(reviews[0]).not.toHaveProperty("title");
    expect(reviews[0]?.text).toContain("without any tight feeling");
    expect(reviews[1]).toMatchObject({ rating: 4, date: "2026-06-30" });
    expect(reviews[1]).not.toHaveProperty("verified_buyer");
  });

  it("never emits reviewer identity", () => {
    const dumped = JSON.stringify([
      ...parseWidgetReviews(fixture("judgeme.html"), "judgeme"),
      ...parseWidgetReviews(fixture("stamped.html"), "stamped"),
      ...parseWidgetReviews(fixture("yotpo.html"), "yotpo"),
      ...parseWidgetReviews(fixture("okendo-plus.html"), "okendo"),
      ...parseWidgetReviews(fixture("okendo-legacy.html"), "okendo"),
      ...parseWidgetReviews(fixture("loox-frame.html"), "loox"),
    ]);
    for (const name of ["Synthetic Reviewer One", "S. R. Two", "Fake Person A", "F. B.", "Made Up User", "U. Ser"]) {
      expect(dumped).not.toContain(name);
    }
  });
});

describe("parseJsonLdReviews", () => {
  it("parses schema.org Review blocks with scales", () => {
    const reviews = parseJsonLdReviews(fixture("jsonld.html"));
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      title: "Silky finish",
      rating: 5,
      rating_scale: 5,
      date: "2026-03-12",
    });
    expect(reviews[1]).toMatchObject({ rating: 7, rating_scale: 10 });
    expect(JSON.stringify(reviews)).not.toContain("Nobody Real");
  });
});

describe("parseAccessibleReviewCards", () => {
  it("parses custom-theme cards via aria ratings and dates", () => {
    const reviews = parseAccessibleReviewCards(fixture("custom.html"));
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      rating: 5,
      rating_scale: 5,
      date: "11/02/2026",
      verified_buyer: true,
    });
    expect(reviews[0]?.text).toContain("Holds my thick hair");
    expect(reviews[1]).toMatchObject({ rating: 3, date: "October 20, 2026" });
    expect(JSON.stringify(reviews)).not.toContain("Invented Shopper");
  });

  it("kicks in when a detected vendor has no standard markup", () => {
    const { vendor, reviews } = collectPageReviews(fixture("custom.html"));
    expect(vendor).toBe("judgeme");
    expect(reviews).toHaveLength(2);
  });
});

describe("collectPageReviews", () => {
  it("merges widget and JSON-LD reviews without duplicates", () => {
    const html = `${fixture("judgeme.html")}${fixture("jsonld.html")}`;
    const { vendor, reviews } = collectPageReviews(html);
    expect(vendor).toBe("judgeme");
    expect(reviews).toHaveLength(5);
  });
});

describe("collectFramesReviews", () => {
  it("finds reviews hidden in an iframe the main frame lacks", () => {
    const main = `<html><head><script src="https://loox.io/widget/x/loox.js"></script></head><body><div class="loox-rating">4.8</div></body></html>`;
    const merged = collectFramesReviews([main, fixture("loox-frame.html")]);
    expect(merged.vendor).toBe("loox");
    expect(merged.domHit).toBe(true);
    expect(merged.reviews).toHaveLength(2);
    expect(merged.reviews[0]).toMatchObject({ rating: 5, date: "2026-07-19" });
  });

  it("reports no widget DOM for script-only frames", () => {
    const merged = collectFramesReviews([
      `<html><head><script src="https://cdn-widgetsrepository.yotpo.com/loyalty.js"></script></head><body></body></html>`,
    ]);
    expect(merged.vendor).toBe("yotpo");
    expect(merged.domHit).toBe(false);
    expect(merged.reviews).toHaveLength(0);
  });
});

describe("parseDisplayedTotal", () => {
  it("reads Judge.me badge and Yotpo header totals", () => {
    expect(parseDisplayedTotal(fixture("judgeme.html"), "judgeme")).toBe(74);
    expect(parseDisplayedTotal(fixture("yotpo.html"), "yotpo")).toBe(1234);
  });

  it("falls back to the JSON-LD aggregate count", () => {
    expect(parseJsonLdAggregateCount(fixture("jsonld.html"))).toBe(128);
    expect(parseDisplayedTotal(fixture("jsonld.html"), null)).toBe(128);
  });

  it("returns null when no total is shown", () => {
    expect(parseDisplayedTotal(fixture("stamped.html"), "stamped")).toBeNull();
    expect(collectPageReviews(fixture("judgeme.html")).displayedTotal).toBe(74);
  });
});

describe("findNextPageNumber", () => {
  it("advances past jdgm-curt and yotpo selected pages", () => {
    expect(findNextPageNumber(fixture("judgeme.html"), [".jdgm-paginate a"])).toEqual({ current: 1, next: 2 });
    expect(findNextPageNumber(fixture("yotpo.html"), [".yotpo-reviews-pagination-item"])).toEqual({
      current: 1,
      next: 2,
    });
  });

  it("ignores aria-current=false when the current page has moved on", () => {
    // Yotpo marks non-current pages with aria-current="false"; a presence
    // check would pin current to 1 and re-click page 2 forever.
    const page2 = `<nav class="yotpo-reviews-pagination-container">
      <a class="yotpo-reviews-pagination-item yotpo-pagination-number" aria-current="false">1</a>
      <a class="selected yotpo-reviews-pagination-item yotpo-pagination-number" aria-current="true">2</a>
      <a class="yotpo-reviews-pagination-item yotpo-pagination-number" aria-current="false">3</a>
    </nav>`;
    expect(findNextPageNumber(page2, [".yotpo-reviews-pagination-item"])).toEqual({ current: 2, next: 3 });
  });

  it("returns null on the last page or without pagination", () => {
    const last = `<div class="jdgm-paginate"><a class="jdgm-paginate__page">1</a><a class="jdgm-paginate__page jdgm-curt">2</a></div>`;
    expect(findNextPageNumber(last, [".jdgm-paginate a"])).toBeNull();
    expect(findNextPageNumber(fixture("stamped.html"), [".stamped-pagination a"])).toBeNull();
  });
});
