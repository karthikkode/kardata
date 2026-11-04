import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

// Use the package's CommonJS entry point under NodeNext, as the main fetcher does.
const parseRobots = createRequire(import.meta.url)("robots-parser") as
  (url: string, text: string) => { isAllowed(url: string, userAgent: string): boolean | undefined };

export type RssEvidenceResult = { url: string; text: string } | { url: string; error: string };

/** Read in memory so callers can sanitize a feed before persisting any text. */
export async function fetchRssEvidence(
  urls: readonly string[],
  options: {
    origin: string; userAgent: string; minimumIntervalMs: number; minimum429PauseMs: number;
    fetcher: typeof fetch; now?: () => number; pause?: (ms: number) => Promise<unknown>;
  },
): Promise<RssEvidenceResult[]> {
  const origin = new URL(options.origin).origin;
  if (!urls.every((url) => {
    const parsed = new URL(url);
    return parsed.origin === origin && !parsed.username && !parsed.password;
  })) throw new Error("All feed paths must use the same approved origin");
  const now = options.now ?? Date.now;
  const pause = options.pause ?? sleep;
  let nextRequest = 0;
  const request = async (url: string) => {
    const waitMs = nextRequest - now();
    if (waitMs > 0) await pause(waitMs);
    nextRequest = now() + options.minimumIntervalMs;
    const response = await options.fetcher(url, {
      headers: { "User-Agent": options.userAgent }, redirect: "manual", signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 429) {
      const value = response.headers.get("Retry-After") ?? "";
      const retryMs = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now();
      nextRequest = Math.max(nextRequest, now() + Math.max(options.minimum429PauseMs, Number.isFinite(retryMs) ? retryMs : 0));
    }
    return response;
  };
  let robots;
  try {
    const robotsUrl = origin + "/robots.txt";
    const policy = await request(robotsUrl);
    if (!policy.ok && policy.status !== 404) {
      return urls.map((url) => ({ url, error: "robots.txt HTTP " + policy.status }));
    }
    robots = parseRobots(robotsUrl, policy.ok ? await policy.text() : "");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return urls.map((url) => ({ url, error: "robots.txt " + detail }));
  }

  const results: RssEvidenceResult[] = [];
  let blocked = false;
  for (const url of urls) {
    if (blocked || robots.isAllowed(url, options.userAgent) !== true) {
      results.push({ url, error: blocked ? "Origin skipped after HTTP 403" : "robots.txt disallows path" });
      continue;
    }
    try {
      const response = await request(url);
      if (response.status === 403) blocked = true;
      results.push(response.ok ? { url, text: await response.text() } : { url, error: "HTTP " + response.status });
    } catch (error) {
      results.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
