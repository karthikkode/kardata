import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Db } from "../../src/db/client.js";
import { collectWebsiteSoftware, companyHomepage, inspectWebsiteSoftware, type WebsiteVendorConfig } from "../../src/collect/collectors/website-software.js";
import type { FetchRequest, FetchResult } from "../../src/collect/fetch.js";

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
