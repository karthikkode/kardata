import { describe, expect, it } from "vitest";
import { buildSeo } from "../src/lib/seo";

describe("buildSeo", () => {
  it("uses site defaults for a bare page", () => {
    const seo = buildSeo({ path: "/" });
    expect(seo.title).toBe("kardata");
    expect(seo.canonical).toBe("https://kardata.co/");
    expect(seo.image).toBe("https://kardata.co/og-default.png");
    expect(seo.type).toBe("website");
  });

  it("builds absolute URLs and article fields for a post", () => {
    const seo = buildSeo({
      title: "A post",
      description: "One line.",
      path: "/blog/a-post/",
      image: "/images/a.png",
      type: "article",
      publishedTime: new Date("2026-11-02T00:00:00Z"),
    });
    expect(seo.title).toBe("A post | kardata");
    expect(seo.canonical).toBe("https://kardata.co/blog/a-post/");
    expect(seo.image).toBe("https://kardata.co/images/a.png");
    expect(seo.publishedTime).toBe("2026-11-02T00:00:00.000Z");
  });
});
