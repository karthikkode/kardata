import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  blobs,
  researchRuns,
  runEvents,
  sources,
} from "../../src/db/schema.js";
import {
  assertPublicHost,
  BudgetExceededError,
  fetchUrl,
  getRobotsTxt,
} from "../../src/collect/fetch.js";
import { DomainError } from "../../src/domain/errors.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { seedCompany, seedRun } from "./helpers.js";
import { sendText, startFakeSite, type FakeSite } from "./fake-site.js";

let handle: DbHandle;
let site: FakeSite;
let companyId: string;
let runId: string;

const ALLOW = ["127.0.0.1"];

function req(url: string, extra: Record<string, unknown> = {}) {
  return {
    runId,
    companyId,
    collector: "test",
    url,
    privateHostAllowlist: ALLOW,
    ...extra,
  };
}

async function requestCount(): Promise<number> {
  const [row] = await handle.db
    .select({ n: researchRuns.requestCount })
    .from(researchRuns)
    .where(eq(researchRuns.id, runId));
  return row?.n ?? -1;
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  companyId = await seedCompany(handle.db);
  runId = await seedRun(handle.db, companyId);
  site.routes.set("/robots.txt", (_req, res) =>
    sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"),
  );
});

afterEach(async () => {
  await site.close();
});

afterAll(async () => {
  await handle.close();
});

describe("fetcher", () => {
  it("fetches a page, stores the blob, and writes source plus event", async () => {
    site.routes.set("/", (_req, res) => sendText(res, "<html><body>Hello</body></html>"));
    const result = await fetchUrl(handle.db, req(`${site.baseUrl}/`));
    expect(result.source.status).toBe("ok");
    expect(result.source.httpStatus).toBe(200);
    expect(result.source.finalUrl).toBe(`${site.baseUrl}/`);
    expect(result.text).toContain("Hello");
    expect(result.body?.byteLength).toBeGreaterThan(0);

    const blobRows = await handle.db.select().from(blobs);
    expect(blobRows.length).toBe(2); // robots.txt + page
    const sourceRows = await handle.db.select().from(sources);
    expect(sourceRows.length).toBe(2);
    const events = await handle.db.select().from(runEvents);
    expect(events.length).toBe(2);
    expect(events[1]?.type).toBe("fetch");
    const payload = (events[1]?.payload ?? {}) as Record<string, unknown>;
    expect(payload.status).toBe("ok");
    expect(payload.bytes).toBeGreaterThan(0);
    expect("body" in payload || "text" in payload).toBe(false);
    expect(await requestCount()).toBe(2);
    expect(site.hits[0]?.userAgent).toMatch(/^KardataBot\/0\.1 \(\+http/);
  });

  it("never fetches a robots-disallowed URL and caches robots.txt", async () => {
    site.routes.set("/robots.txt", (_req, res) =>
      sendText(res, "User-agent: *\nDisallow: /private\n", 200, "text/plain"),
    );
    site.routes.set("/private/x", (_req, res) => sendText(res, "secret"));
    site.routes.set("/open", (_req, res) => sendText(res, "public"));

    const blocked = await fetchUrl(handle.db, req(`${site.baseUrl}/private/x`));
    expect(blocked.source.status).toBe("robots_disallowed");
    expect(blocked.body).toBeUndefined();
    expect(site.hits.some((h) => h.path === "/private/x")).toBe(false);

    const open = await fetchUrl(handle.db, req(`${site.baseUrl}/open`));
    expect(open.source.status).toBe("ok");
    expect(site.hits.filter((h) => h.path === "/robots.txt").length).toBe(1);
  });

  it("exposes sitemap urls from robots.txt", async () => {
    site.routes.set("/robots.txt", (_req, res) =>
      sendText(
        res,
        `User-agent: *\nDisallow:\nSitemap: ${site.baseUrl}/sitemap.xml\nSitemap: ${site.baseUrl}/other.xml\n`,
        200,
        "text/plain",
      ),
    );
    const robots = await getRobotsTxt(handle.db, req(`${site.baseUrl}/`));
    expect(robots.sitemaps).toEqual([`${site.baseUrl}/sitemap.xml`, `${site.baseUrl}/other.xml`]);
  });

  it("waits 2s between sequential requests to one host", async () => {
    site.routes.set("/a", (_req, res) => sendText(res, "a"));
    site.routes.set("/b", (_req, res) => sendText(res, "b"));
    const started = Date.now();
    await fetchUrl(handle.db, req(`${site.baseUrl}/a`));
    await fetchUrl(handle.db, req(`${site.baseUrl}/b`));
    expect(Date.now() - started).toBeGreaterThanOrEqual(3900);
  });

  it("serializes concurrent requests to one host", async () => {
    site.routes.set("/a", (_req, res) => sendText(res, "a"));
    site.routes.set("/b", (_req, res) => sendText(res, "b"));
    const started = Date.now();
    await Promise.all([
      fetchUrl(handle.db, req(`${site.baseUrl}/a`)),
      fetchUrl(handle.db, req(`${site.baseUrl}/b`)),
    ]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3900);
  });

  it("refuses oversized responses", async () => {
    site.routes.set("/chunked", (_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("x".repeat(60));
      res.write("y".repeat(60));
      res.end();
    });
    const small = await fetchUrl(handle.db, req(`${site.baseUrl}/chunked`, { maxBytes: 100 }));
    expect(small.source.status).toBe("error");
    expect(small.source.error).toContain("too large");
    expect(small.source.blobSha256).toBeNull();

    site.routes.set("/big", (_req, res) => sendText(res, "z".repeat(6 * 1024 * 1024)));
    const big = await fetchUrl(handle.db, req(`${site.baseUrl}/big`));
    expect(big.source.status).toBe("error");
  });

  it("times out a hanging response", async () => {
    site.routes.set("/hang", () => {});
    const result = await fetchUrl(handle.db, req(`${site.baseUrl}/hang`, { timeoutMs: 200 }));
    expect(result.source.status).toBe("error");
    expect(result.source.error).toContain("timeout");
  });

  it("follows redirects up to the limit and records the final url", async () => {
    site.routes.set("/r1", (_req, res) => {
      res.writeHead(302, { location: "/r2" });
      res.end();
    });
    site.routes.set("/r2", (_req, res) => {
      res.writeHead(302, { location: "/r3" });
      res.end();
    });
    site.routes.set("/r3", (_req, res) => {
      res.writeHead(302, { location: "/ok" });
      res.end();
    });
    site.routes.set("/ok", (_req, res) => sendText(res, "arrived"));
    const limited = await fetchUrl(handle.db, req(`${site.baseUrl}/r1`, { maxRedirects: 2 }));
    expect(limited.source.status).toBe("error");
    expect(limited.source.error).toContain("too many redirects");
    const followed = await fetchUrl(handle.db, req(`${site.baseUrl}/r1`));
    expect(followed.source.status).toBe("ok");
    expect(followed.source.finalUrl).toBe(`${site.baseUrl}/ok`);
    expect(followed.text).toBe("arrived");
  });

  it("refuses private addresses, including after a redirect", async () => {
    const denied = await fetchUrl(handle.db, {
      runId,
      companyId,
      collector: "test",
      url: `${site.baseUrl}/`,
      privateHostAllowlist: [],
    });
    expect(denied.source.status).toBe("error");
    expect(denied.source.error).toContain("non-public");
    expect(site.hits.length).toBe(0);

    site.routes.set("/redir", (_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.2:1/" });
      res.end();
    });
    const hopped = await fetchUrl(handle.db, req(`${site.baseUrl}/redir`));
    expect(hopped.source.status).toBe("error");
    expect(hopped.source.error).toContain("non-public");
  });

  it("normalizes obfuscated loopback urls", async () => {
    const port = new URL(site.baseUrl).port;
    site.routes.set("/", (_req, res) => sendText(res, "home"));
    for (const host of ["2130706433", "0x7f.0.0.1"]) {
      const refused = await fetchUrl(
        handle.db,
        req(`http://${host}:${port}/`, { privateHostAllowlist: [] }),
      );
      expect(refused.source.status).toBe("error");
      expect(refused.source.error).toContain("non-public");
    }
    expect(site.hits.length).toBe(0);
    const allowed = await fetchUrl(handle.db, req(`http://2130706433:${port}/`));
    expect(allowed.source.status).toBe("ok");
  });

  it("classifies addresses for the ssrf guard", async () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "1.1.1.1"]) {
      await expect(assertPublicHost(ip, [])).resolves.toBeUndefined();
    }
    for (const host of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "172.31.255.1",
      "192.168.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "fe80::1",
      "fc00::1",
      "localhost",
    ]) {
      await expect(assertPublicHost(host, [])).rejects.toThrow(/non-public/);
    }
    await expect(assertPublicHost("127.0.0.1", ["127.0.0.1"])).resolves.toBeUndefined();
    await expect(assertPublicHost("nonexistent.invalid", [])).rejects.toThrow(/cannot resolve/);
  });

  it("marks challenge pages and bot statuses as blocked", async () => {
    site.routes.set("/challenge", (_req, res) =>
      sendText(
        res,
        '<html><head><title>Just a moment...</title><script src="/cf-chl/foo.js"></script></head><body>verify</body></html>',
      ),
    );
    site.routes.set("/denied", (_req, res) => sendText(res, "no", 403));
    site.routes.set("/limited", (_req, res) => sendText(res, "slow", 429));
    site.routes.set("/missing", (_req, res) => sendText(res, "gone", 404));
    site.routes.set("/broken", (_req, res) => sendText(res, "oops", 500));

    const challenge = await fetchUrl(handle.db, req(`${site.baseUrl}/challenge`));
    expect(challenge.source.status).toBe("blocked");
    expect(challenge.source.blobSha256).toBeNull();
    expect(challenge.body).toBeUndefined();

    const denied = await fetchUrl(handle.db, req(`${site.baseUrl}/denied`));
    expect(denied.source.status).toBe("blocked");
    expect(denied.source.httpStatus).toBe(403);
    const limited = await fetchUrl(handle.db, req(`${site.baseUrl}/limited`));
    expect(limited.source.status).toBe("blocked");
    const missing = await fetchUrl(handle.db, req(`${site.baseUrl}/missing`));
    expect(missing.source.status).toBe("not_found");
    const broken = await fetchUrl(handle.db, req(`${site.baseUrl}/broken`));
    expect(broken.source.status).toBe("error");
    expect(broken.source.httpStatus).toBe(500);
  });

  it("dedupes identical bodies by hash", async () => {
    site.routes.set("/same1", (_req, res) => sendText(res, "identical body"));
    site.routes.set("/same2", (_req, res) => sendText(res, "identical body"));
    const first = await fetchUrl(handle.db, req(`${site.baseUrl}/same1`));
    const second = await fetchUrl(handle.db, req(`${site.baseUrl}/same2`));
    expect(first.source.blobSha256).toBeTruthy();
    expect(second.source.blobSha256).toBe(first.source.blobSha256);
    const blobRows = await handle.db.select().from(blobs);
    expect(blobRows.length).toBe(2); // robots.txt + one shared body
  });

  it("stops at 80 requests with a recorded error", async () => {
    site.routes.set("/", (_req, res) => sendText(res, "x"));
    await handle.db
      .update(researchRuns)
      .set({ requestCount: 80 })
      .where(eq(researchRuns.id, runId));
    await expect(fetchUrl(handle.db, req(`${site.baseUrl}/`))).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    const [source] = await handle.db.select().from(sources);
    expect(source?.status).toBe("error");
    expect(source?.error).toContain("budget");
    expect(await requestCount()).toBe(80);
  });

  it("rejects unknown runs and non-http urls", async () => {
    await expect(
      fetchUrl(handle.db, req(`${site.baseUrl}/`, { runId: randomUUID() })),
    ).rejects.toBeInstanceOf(DomainError);
    const ftp = await fetchUrl(handle.db, req("ftp://example.com/x"));
    expect(ftp.source.status).toBe("error");
    expect(ftp.source.error).toContain("http(s)");
  });
});
