import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectPageReviews,
  detectVendor,
  parseAccessibleReviewCards,
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

  it("never emits reviewer identity", () => {
    const dumped = JSON.stringify([
      ...parseWidgetReviews(fixture("judgeme.html"), "judgeme"),
      ...parseWidgetReviews(fixture("stamped.html"), "stamped"),
      ...parseWidgetReviews(fixture("yotpo.html"), "yotpo"),
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
