import { describe, expect, it } from "vitest";
import { alternateSiteBase, siteBase } from "../../src/collect/collectors/util.js";
import type { CollectorCtx } from "../../src/collect/collectors/types.js";

describe("www/bare twin of a site", () => {
  it("adds or removes www and keeps scheme and port", () => {
    expect(alternateSiteBase("http://www.example.co.uk")).toBe("http://example.co.uk");
    expect(alternateSiteBase("https://example.com")).toBe("https://www.example.com");
    expect(alternateSiteBase("https://shop.example.com:8443")).toBe("https://www.shop.example.com:8443");
  });

  it("has no twin for an IP or a single-label host", () => {
    expect(alternateSiteBase("http://127.0.0.1:4000")).toBeNull();
    expect(alternateSiteBase("http://localhost:4000")).toBeNull();
    expect(alternateSiteBase("http://[::1]:4000")).toBeNull();
  });

  it("siteBase prefers the twin the site collector found", () => {
    const ctx = {
      effective: { website: "http://www.example.co.uk", domain: "example.co.uk" },
      shared: {},
    } as unknown as CollectorCtx;
    expect(siteBase(ctx)).toBe("http://www.example.co.uk");
    ctx.shared.siteBase = "http://example.co.uk";
    expect(siteBase(ctx)).toBe("http://example.co.uk");
  });
});
