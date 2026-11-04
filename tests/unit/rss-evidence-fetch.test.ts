import { describe, expect, it, vi } from "vitest";
import { fetchRssEvidence } from "../../src/domain/research/rss-evidence-fetch.js";

const origin = "https://example.com";
const urls = [origin + "/first.rss", origin + "/second.rss", origin + "/third.rss"];
const limits = { origin, userAgent: "test-reader", minimumIntervalMs: 60_000, minimum429PauseMs: 600_000 };

describe("RSS evidence fetching", () => {
  it("checks robots without requesting disallowed streams", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("User-agent: *\nDisallow: /"));
    const results = await fetchRssEvidence(urls, { ...limits, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(origin + "/robots.txt");
    expect(results.every((row) => "error" in row && row.error === "robots.txt disallows path")).toBe(true);
  });

  it("spaces requests and applies a ten-minute pause after 429", async () => {
    let clock = 0;
    const started: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      started.push(clock);
      if (url === origin + "/robots.txt") return new Response("User-agent: *\nAllow: /");
      if (url === urls[1]) return new Response("", { status: 429, headers: { "Retry-After": "30" } });
      return new Response("<feed/>");
    });
    const results = await fetchRssEvidence(urls, {
      ...limits, fetcher, now: () => clock, pause: async (ms) => { clock += ms; },
    });
    expect(started).toEqual([0, 60_000, 120_000, 720_000]);
    expect(results).toEqual([
      { url: urls[0], text: "<feed/>" }, { url: urls[1], error: "HTTP 429" }, { url: urls[2], text: "<feed/>" },
    ]);
  });

  it("stops an origin on HTTP 403 and never follows a redirect", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("User-agent: *\nAllow: /"))
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { Location: "https://other.example/feed" } }))
      .mockResolvedValueOnce(new Response("", { status: 403 }));
    const results = await fetchRssEvidence(urls, { ...limits, fetcher, pause: async () => {} });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([, options]) => options?.redirect === "manual")).toBe(true);
    expect(results).toEqual([
      { url: urls[0], error: "HTTP 302" }, { url: urls[1], error: "HTTP 403" }, { url: urls[2], error: "Origin skipped after HTTP 403" },
    ]);
  });
});
