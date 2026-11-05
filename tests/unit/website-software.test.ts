import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Db } from "../../src/db/client.js";
import { collectWebsiteSoftware, companyHomepage, inspectWebsiteSoftware, type WebsiteVendorConfig } from "../../src/collect/collectors/website-software.js";
import type { FetchRequest, FetchResult } from "../../src/collect/fetch.js";
import { selectWebsiteInputs, websiteCheckKey } from "../../src/domain/benchmark/website-input.js";

const config: WebsiteVendorConfig = {
  excludedHosts: ["social.example"],
  vendors: [
    { host: "vendor.example", vendor: "Fixture portal", category: "portal", loginOnly: true },
    { host: "scheduler.example", vendor: "Fixture scheduling", category: "scheduling" },
    { host: "forms.example", vendor: "Fixture forms", category: "form" },
  ],
};
const homepage = new URL("https://firm.example/");
const html = readFileSync(new URL("../fixtures/website-software.html", import.meta.url), "utf8");

it("resolves relative links and matches hostname labels and portal context", () => {
  expect(companyHomepage("firm.example/about", config)?.href).toBe(homepage.href);
  expect(companyHomepage("https://profiles.social.example/firm", config)).toBeNull();
  const result = inspectWebsiteSoftware(html, homepage.href, config);
  expect(result.clientPage).toBe("https://firm.example/clients");
  expect(result.signals.map(signal => signal.vendor)).toEqual(["Fixture portal", "Fixture scheduling"]);
});

it("fetches one homepage and at most one linked client page, with evidence", async () => {
  const calls: string[] = [];
  const db = {} as Db;
  const result = await collectWebsiteSoftware(db, { companyId: "company", runId: "run", homepage, config }, async (_db, request: FetchRequest) => {
    calls.push(request.url);
    expect(request.strictRobots).toBe(true);
    expect(request.redirectHost).toBe("firm.example");
    return { source: { finalUrl: request.url, status: "ok" }, text: calls.length === 1 ? html :
      '<iframe src="https://forms.example/client"></iframe><a href="/login-3">Client login</a>', contentType: "text/html" } as FetchResult;
  });
  expect(calls).toEqual([homepage.href, "https://firm.example/clients"]);
  expect(result.status).toBe("found");
  expect(result.signals).toContainEqual({
    vendor: "Fixture forms", category: "form", url: "https://forms.example/client", page: "https://firm.example/clients",
  });
});

it("keeps retryable fetch failures distinct from blocked and successful empty results", async () => {
  const db = {} as Db;
  const input = { companyId: "company", runId: "run", homepage, config };
  const result = (status: string) => collectWebsiteSoftware(db, input, async () => ({
    source: { finalUrl: homepage.href, status }, text: status === "ok" ? "<p>no portal</p>" : undefined, contentType: "text/html",
  } as FetchResult));
  expect((await result("blocked")).status).toBe("blocked");
  expect((await result("error")).status).toBe("fetch_error");
  expect((await result("ok")).status).toBe("none_found");
});

it("uses a stored domain only when no usable site exists and skips globally shared domains", () => {
  const directory = [
    { id: "unique", website: null, domain: "unique.example", sharedDomain: false },
    { id: "preferred", website: "https://site.example/about", domain: "other.example", sharedDomain: false },
    { id: "social", website: "https://social.example/firm", domain: "actual.example", sharedDomain: false },
    { id: "shared", website: null, domain: "shared.example", sharedDomain: false },
    { id: "outside-selection", website: "https://www.shared.example/", domain: null, sharedDomain: false },
    { id: "flagged", website: null, domain: "flagged.example", sharedDomain: true },
    { id: "excluded-shared", website: null, domain: "social.example", sharedDomain: true },
    { id: "missing", website: null, domain: null, sharedDomain: false },
  ];
  const inputs = selectWebsiteInputs(directory, new Set(directory.map(c => c.id)), config);
  expect(inputs.get("unique")).toMatchObject({ kind: "domain", shared: false });
  expect(inputs.get("unique")?.home?.href).toBe("https://unique.example/");
  expect(inputs.get("preferred")?.home?.href).toBe("https://site.example/");
  expect(inputs.get("social")?.home?.href).toBe("https://actual.example/");
  expect(inputs.get("shared")?.shared).toBe(true);
  expect(inputs.get("flagged")?.shared).toBe(true);
  expect(inputs.get("excluded-shared")?.shared).toBe(true);
  expect(websiteCheckKey(config, inputs.get("shared")!)).toBeNull();
  expect(inputs.get("missing")).toEqual({ home: null, kind: null, shared: false });
  expect(websiteCheckKey(config, inputs.get("missing")!)).toMatch(/:missing$/);
});

it.each(["blocked", "robots_disallowed", "error"])("stops at a %s homepage without visiting another page", async status => {
  let calls = 0;
  const result = await collectWebsiteSoftware({} as Db, { companyId: "company", runId: "run", homepage, config }, async () => {
    calls++;
    return { source: { finalUrl: homepage.href, status, error: "robots.txt unavailable" } } as FetchResult;
  });
  expect(calls).toBe(1);
  expect(result.status).toBe(status === "error" ? "robots_unavailable" : status);
});
