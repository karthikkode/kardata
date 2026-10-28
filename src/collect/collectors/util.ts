import { load, type CheerioAPI } from "cheerio";
import { saveDocument } from "../../domain/research/documents.js";
import {
  addFacts,
  type AddFactItem,
} from "../../domain/research/facts.js";
import {
  upsertRecords,
  type UpsertRecordItem,
} from "../../domain/research/records.js";
import { fetchUrl, type FetchOptions, type FetchResult } from "../fetch.js";
import type { CollectorCtx, FetchedPage, PageLink } from "./types.js";

export async function collectFetch(
  ctx: CollectorCtx,
  collector: string,
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  return fetchUrl(ctx.db, {
    runId: ctx.runId,
    companyId: ctx.companyId,
    collector,
    url,
    privateHostAllowlist: ctx.privateHostAllowlist,
    ...opts,
  });
}

// Exact message for a fetch that did not return a usable body.
export function fetchFailure(res: FetchResult): string {
  const s = res.source;
  if (s.error) return `${s.status} ${s.error}`.trim();
  if (s.httpStatus !== null && s.httpStatus !== undefined) {
    return `${s.status} HTTP ${s.httpStatus}`;
  }
  return s.status;
}

export function siteBase(ctx: CollectorCtx): string | null {
  if (ctx.shared.siteBase) return ctx.shared.siteBase;
  const { website, domain } = ctx.effective;
  if (website && /^https?:\/\//i.test(website.trim())) {
    try {
      return new URL(website.trim()).origin;
    } catch {
      return null;
    }
  }
  if (domain && domain.trim() !== "") return `https://${domain.trim()}`;
  return null;
}

/** The same site with "www." added or removed; null for an IP or a single-label host. */
export function alternateSiteBase(base: string): string | null {
  const url = new URL(base);
  const host = url.hostname;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[") || !host.includes(".")) return null;
  url.hostname = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return url.origin;
}

export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function pageText($: CheerioAPI): string {
  $("script, style, noscript, template, svg").remove();
  return normalizeWhitespace($.root().text()).slice(0, 20000);
}

export function pageLinks($: CheerioAPI, base: string): PageLink[] {
  const links: PageLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href")?.trim() ?? "";
    if (raw === "" || raw.startsWith("#") || raw.startsWith("mailto:")) return;
    let href: string;
    try {
      href = new URL(raw, base).href;
    } catch {
      return;
    }
    if (seen.has(href)) return;
    seen.add(href);
    links.push({ href, text: normalizeWhitespace($(el).text()).slice(0, 200) });
  });
  return links;
}

export function pageScripts($: CheerioAPI, base: string): string[] {
  const scripts: string[] = [];
  $("script[src]").each((_, el) => {
    const raw = $(el).attr("src")?.trim() ?? "";
    if (raw === "") return;
    try {
      scripts.push(new URL(raw, base).href);
    } catch {
      // ignore unparseable src
    }
  });
  return [...new Set(scripts)];
}

export function pageJsonLd($: CheerioAPI): unknown[] {
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (raw.trim() === "") return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      // ignore unparseable JSON-LD
    }
  });
  return blocks;
}

export function toFetchedPage(
  url: string,
  finalUrl: string,
  sourceId: string,
  html: string,
): FetchedPage {
  const $ = loadHtml(html);
  const title = normalizeWhitespace($("title").first().text()).slice(0, 300);
  // pageText strips scripts, so extract script-derived data first.
  const links = pageLinks($, finalUrl);
  const scripts = pageScripts($, finalUrl);
  const jsonLd = pageJsonLd($);
  return { url, finalUrl, sourceId, title, html, text: pageText($), links, scripts, jsonLd };
}

// Normalize a company name for confident-match comparisons: lowercase,
// punctuation stripped, corporate suffixes removed.
const NAME_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "llc",
  "ltd",
  "limited",
  "co",
  "company",
  "plc",
  "pbc",
  "corpinc",
  "pa",
  "pllc",
  "gmbh",
  "bv",
  "pty",
  "sas",
  "srl",
  "ab",
]);

export function normalizeName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1] ?? "")) {
    words.pop();
  }
  if (words[0] === "the") words.shift();
  return words.join(" ");
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "";
  const rounded = Math.abs(amount) >= 1000 ? Math.round(amount).toLocaleString("en-US") : String(amount);
  return symbol !== "" ? `${symbol}${rounded} ${currency}` : `${rounded} ${currency}`;
}

export async function writeExtract(
  ctx: CollectorCtx,
  collector: string,
  path: string,
  title: string,
  contentMd: string,
  sourceIds: string[],
): Promise<string> {
  const saved = await saveDocument(ctx.db, {
    companyId: ctx.companyId,
    runId: ctx.runId,
    path,
    kind: "extract",
    title,
    contentMd,
    sourceIds,
    createdBy: `collector:${collector}`,
  });
  return saved.id;
}

// Collectors construct valid items, so a validation failure is a code bug:
// fail fast with the exact message rather than writing half a result.
export async function writeFacts(
  ctx: CollectorCtx,
  collector: string,
  items: AddFactItem[],
): Promise<string[]> {
  if (items.length === 0) return [];
  const results = await addFacts(ctx.db, {
    companyId: ctx.companyId,
    runId: ctx.runId,
    createdBy: `collector:${collector}`,
    facts: items,
    strict: true,
  });
  return results.map((r) => {
    if (!r.ok) throw new Error(`fact write failed (${collector}): ${r.error}`);
    return r.id;
  });
}

export async function writeRecords(
  ctx: CollectorCtx,
  collector: string,
  items: UpsertRecordItem[],
): Promise<string[]> {
  if (items.length === 0) return [];
  const results = await upsertRecords(ctx.db, {
    companyId: ctx.companyId,
    runId: ctx.runId,
    createdBy: `collector:${collector}`,
    records: items,
    strict: true,
  });
  return results.map((r) => {
    if (!r.ok) throw new Error(`record write failed (${collector}): ${r.error}`);
    return r.id;
  });
}
