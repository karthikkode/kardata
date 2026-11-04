import { load } from "cheerio";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { fetchUrl, type FetchResult } from "../fetch.js";

const host = z.string().regex(/^[a-z\d-]+(?:\.[a-z\d-]+)+$/);
export const websiteVendorConfig = z.object({
  excludedHosts: z.array(host),
  vendors: z.array(z.object({
    host, vendor: z.string().min(1), category: z.enum(["portal", "custodian", "scheduling", "form", "esign"]),
    loginOnly: z.boolean().optional(),
  })),
});
export type WebsiteVendorConfig = z.infer<typeof websiteVendorConfig>;
export const WEBSITE_SOFTWARE_COLLECTOR = "website_software";
export const WEBSITE_SCAN_TYPE = "website_software";

const CLIENT_LINK = /\b(?:log[ -]?in|sign[ -]?in|client\s+(?:access|center|portal|accounts?|resources?)|investor\s+portal)\b/i;
const CLIENT_PATH = /\b(?:log[ -]?in|sign[ -]?in|clients?|portal)\b/i;

function matchesHost(candidate: string, suffix: string) {
  return candidate === suffix || candidate.endsWith(`.${suffix}`);
}

export function webUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function companyHomepage(website: string | null, config: WebsiteVendorConfig) {
  if (!website?.trim()) return null;
  const raw = website.trim();
  const url = webUrl(/^[a-z][\w+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`);
  if (!url || config.excludedHosts.some(suffix => matchesHost(url.hostname, suffix)) ||
      config.vendors.some(vendor => matchesHost(url.hostname, vendor.host))) return null;
  return new URL("/", url);
}

export function inspectWebsiteSoftware(html: string, page: string, config: WebsiteVendorConfig) {
  const $ = load(html);
  const base = new URL(page);
  const signals = new Map<string, { vendor: string; category: string; url: string; page: string }>();
  let clientPage: string | null = null;
  const bySpecificity = [...config.vendors].sort((a, b) => b.host.length - a.host.length);
  $("a[href],iframe[src],form[action]").each((_index, node) => {
    const link = $(node);
    const href = link.attr("href") ?? link.attr("src") ?? link.attr("action");
    if (!href?.trim() || href.trim().startsWith("#")) return;
    const target = webUrl(href, base.href);
    if (!target) return;
    const text = [link.text(), link.attr("title"), link.attr("aria-label"), link.find("img").attr("alt")].filter(Boolean).join(" ");
    const isClient = CLIENT_LINK.test(text) || CLIENT_PATH.test(target.pathname.replace(/[_-]/g, " "));
    const matched = bySpecificity.find(vendor => matchesHost(target.hostname, vendor.host) && (!vendor.loginOnly || isClient));
    if (matched) {
      const signal = { vendor: matched.vendor, category: matched.category, url: target.href, page: base.href };
      signals.set(`${signal.vendor}|${signal.url}`, signal);
    } else if (!clientPage && node.tagName === "a" && target.host === base.host && target.href !== base.href && isClient) {
      clientPage = target.href;
    }
  });
  return { signals: [...signals.values()], clientPage };
}

function pageFailure(page: FetchResult) {
  if (page.source.status !== "ok" || page.text === undefined) {
    if (page.source.status === "robots_disallowed") return "robots_disallowed";
    if (page.source.status === "blocked") return "blocked";
    if (page.source.error === "redirect outside the allowed site or path") return "blocked_redirect";
    if (page.source.status === "not_found") return "not_found";
    return "fetch_error";
  }
  if (page.contentType && !/html/i.test(page.contentType)) return "unsupported_content";
  return null;
}

export async function collectWebsiteSoftware(db: Db, input: {
  companyId: string; runId: string; homepage: URL; config: WebsiteVendorConfig;
}, fetchPage = fetchUrl) {
  const request = (url: string) => fetchPage(db, {
    companyId: input.companyId, runId: input.runId, collector: WEBSITE_SOFTWARE_COLLECTOR,
    url, accept: "text/html,application/xhtml+xml", maxBytes: 2 * 1024 * 1024,
    redirectHost: input.homepage.host, strictRobots: true,
  });
  const home = await request(input.homepage.href);
  const pages = [home.source];
  const homeFailure = pageFailure(home);
  if (homeFailure) return { status: homeFailure, pages, signals: [], clientStatus: null };
  const homeResult = inspectWebsiteSoftware(home.text!, home.source.finalUrl, input.config);
  const signals = homeResult.signals;
  let clientStatus: string | null = null;
  if (homeResult.clientPage) {
    const client = await request(homeResult.clientPage);
    pages.push(client.source);
    clientStatus = pageFailure(client);
    if (!clientStatus) signals.push(...inspectWebsiteSoftware(client.text!, client.source.finalUrl, input.config).signals);
  }
  const distinct = [...new Map(signals.map(signal => [`${signal.vendor}|${signal.url}|${signal.page}`, signal])).values()];
  return { status: distinct.length ? "found" : clientStatus ?? "none_found", pages, signals: distinct, clientStatus };
}
