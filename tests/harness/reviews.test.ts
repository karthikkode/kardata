import { describe, expect, it } from "vitest";
import { reviewsJobArgs, reviewsJobOutput } from "../../src/harness/reviews.js";

describe("reviewsJobArgs", () => {
  it("runs the baked-in scraper with no secrets, mounts or MCP", () => {
    const args = reviewsJobArgs("run-1", [{ url: "https://shop.example/p/a", product: "A" }]);
    const joined = args.join(" ");
    expect(args.at(-2)).toBe("kardata-agent");
    expect(args.at(-1)).toBe("reviews");
    expect(joined).toContain("--network kardata_agents");
    expect(joined).toContain("--read-only");
    expect(joined).toContain("HOME=/tmp");
    expect(joined).not.toContain("-v");
    expect(joined).not.toContain("--mount");
    expect(joined).not.toContain("KARDATA_MCP_AUTH");
    expect(joined).not.toContain("kardata_muse");
    expect(joined).not.toContain("--mcp-config");
  });

  it("refuses an empty page list", () => {
    expect(() => reviewsJobArgs("run-1", [])).toThrow("at least one page");
  });
});

describe("reviewsJobOutput", () => {
  it("strips unknown fields from job reviews", () => {
    const parsed = reviewsJobOutput.parse({
      pages: [{ url: "https://shop.example/p/a", product: "A", vendor: "judgeme", status: "done", reviewCount: 1 }],
      reviews: [
        {
          text: "Great cream.",
          rating: 5,
          author: "Sneaky Name",
          reviewer_email: "x@y.z",
        },
      ],
    });
    expect(parsed.reviews[0]).toEqual({ text: "Great cream.", rating: 5 });
  });
});
