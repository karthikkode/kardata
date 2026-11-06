import { SEC_FIRM_USER_AGENT } from "../../collect/collectors/sec-firm.js";

/** Preserve fetcher safety/robots/delay policy; identify official requests correctly. */
export function sourceFetchPolicy(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  return host === "sec.gov" || host === "www.sec.gov" ? { userAgent: SEC_FIRM_USER_AGENT } : {};
}
