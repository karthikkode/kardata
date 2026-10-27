import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { load } from "cheerio";
import { eq } from "drizzle-orm";
import { fetchUrl, type FetchResult } from "../collect/fetch.js";
import type { Db } from "../db/client.js";
import {
  companies,
  researchRuns,
  sectorPreflight,
  type Company,
  type ResearchRun,
} from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { logClassifierCall } from "../domain/logging/provider-calls.js";
import { extractText } from "../domain/research/reads.js";
import { verifyQuote } from "../domain/research/grounding.js";
import {
  buildClassifierPrompt,
  classifierSchemaFor,
  parseClassification,
  type Classification,
  type ClassifierPage,
} from "../domain/sector-preflight/classify.js";
import { getProfile, profileHash } from "../domain/sector-preflight/profile.js";
import { toEffectiveCompany } from "../domain/companies.js";
import { classifyRunArgs, prepareClassifyInput } from "../harness/classify.js";
import { MuseHandle } from "../harness/muse.js";
import type { HarnessUsage } from "../harness/types.js";

/**
 * Sector-preflight classification (Stage 5.1 Step 1): deterministic inputs
 * through the existing fetcher, one tool-less classifier call, quote
 * grounding like Stage 4.3, stored on sector_preflight. Each attempt is a
 * fresh kind=sector_preflight run, driven inline (never queued, so no engine
 * claims it).
 */

const SECTOR_COLLECTOR = "sector_preflight";
const PAGE_TEXT_BUDGET = 30_000;
const SUBPAGE_MAX = 2;
const CLASSIFY_STALL_MS = 120_000;
const APOLLO_DESCRIPTION_MAX = 500;

export interface ClassifierCallResult {
  json: unknown;
  usage: HarnessUsage | undefined;
  raw?: string;
}

/** One tool-less schema call; injectable for tests. */
export type ClassifierCall = (input: {
  runId: string;
  prompt: string;
  schema: string;
}) => Promise<ClassifierCallResult>;

export const dockerClassifierCall: ClassifierCall = async ({ runId, prompt, schema }) => {
  const input = await prepareClassifyInput(prompt, schema);
  try {
    const child = spawn("docker", classifyRunArgs({ runId, inputDir: input.dir }), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000);
    });
    const handle = new MuseHandle(child, CLASSIFY_STALL_MS);
    const consume = (async () => {
      for await (const event of handle.events) {
        void event;
      }
    })();
    const result = await handle.wait();
    await consume;
    if (result.exitCode !== 0) {
      const detail = stderr.trim() === "" ? "no stderr" : stderr.trim().split("\n").slice(-3).join(" | ");
      throw new Error(`classifier container exited ${result.exitCode}: ${detail}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(result.finalMessage) as unknown;
    } catch {
      throw new Error("classifier returned invalid JSON");
    }
    return { json, usage: result.usage, raw: result.finalMessage };
  } finally {
    await input.cleanup();
  }
};

function apolloDescription(company: Company): string | null {
  const raw = (company.raw ?? {}) as Record<string, unknown>;
  for (const key of ["short_description", "description", "seo_description"]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim().slice(0, APOLLO_DESCRIPTION_MAX);
  }
  return null;
}

function companyOrigin(company: Company): string | null {
  const effective = toEffectiveCompany(company);
  const website = (effective.website ?? "").trim();
  if (website !== "") {
    try {
      return new URL(website.startsWith("http") ? website : `https://${website}`).origin;
    } catch {
      return null;
    }
  }
  const domain = (effective.domain ?? "").trim();
  if (domain === "") return null;
  return `https://${domain.replace(/^https?:\/\//, "").split("/")[0]}`;
}

/** Same-host about/shop/product links from the homepage, about-ish first. */
export function pickSubpages(html: string, origin: string): string[] {
  const $ = load(html);
  const seen = new Set<string>();
  const about: string[] = [];
  const shop: string[] = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (href === "" || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      return;
    }
    if (url.origin !== origin) return;
    const key = `${url.pathname.toLowerCase()}${url.search}`;
    if (seen.has(key)) return;
    seen.add(key);
    const path = url.pathname.toLowerCase();
    if (/about|story|brand|who-we-are/.test(path)) about.push(url.toString());
    else if (/shop|product|store|collection|shop-all/.test(path)) shop.push(url.toString());
  });
  return [...about, ...shop].slice(0, SUBPAGE_MAX);
}

function pageText(result: FetchResult): string {
  if (result.text !== undefined && result.text !== "") return result.text;
  if (!result.body) return "";
  const contentType = result.contentType ?? "";
  if (!/html|text|json/i.test(contentType) && contentType !== "") return "";
  const raw = result.body.toString("utf8");
  return /html/i.test(contentType) || raw.trimStart().startsWith("<") ? extractText(raw) : raw;
}

interface FetchedInputs {
  pages: ClassifierPage[];
  shopify: string | null;
  apolloOnly: boolean;
}

async function fetchInputs(
  db: Db,
  runId: string,
  company: Company,
  fetchOptions: { privateHostAllowlist?: string[] },
): Promise<FetchedInputs> {
  const origin = companyOrigin(company);
  if (!origin) return { pages: [], shopify: null, apolloOnly: true };
  let homepage: FetchResult;
  try {
    homepage = await fetchUrl(db, { runId, companyId: company.id, collector: SECTOR_COLLECTOR, url: origin, ...fetchOptions });
  } catch {
    return { pages: [], shopify: null, apolloOnly: true };
  }
  if (homepage.source.status !== "ok") return { pages: [], shopify: null, apolloOnly: true };
  const html = homepage.body?.toString("utf8") ?? "";
  const urls = [origin, ...pickSubpages(html, origin)];
  const pages: ClassifierPage[] = [];
  let remaining = PAGE_TEXT_BUDGET;
  for (const [index, url] of urls.entries()) {
    const result =
      index === 0
        ? homepage
        : await fetchUrl(db, { runId, companyId: company.id, collector: SECTOR_COLLECTOR, url, ...fetchOptions }).catch(() => null);
    if (!result || result.source.status !== "ok") continue;
    const text = pageText(result).slice(0, remaining);
    if (text.trim() === "") continue;
    remaining -= text.length;
    pages.push({ sourceId: result.source.id, url: result.source.finalUrl, text });
    if (remaining <= 0) break;
  }
  if (pages.length === 0) return { pages, shopify: null, apolloOnly: true };
  // One cheap Shopify probe, no locale fallbacks.
  let shopify: string | null = null;
  try {
    const probe = await fetchUrl(db, {
      runId,
      companyId: company.id,
      collector: SECTOR_COLLECTOR,
      url: `${origin}/products.json?limit=1`,
      accept: "application/json",
      ...fetchOptions,
    });
    if (probe.source.status === "ok" && probe.body) {
      try {
        const parsed = JSON.parse(probe.body.toString("utf8")) as { products?: { title?: string }[] };
        const count = parsed.products?.length ?? 0;
        shopify =
          count > 0
            ? `products.json serves products (first: ${(parsed.products?.[0]?.title ?? "untitled").slice(0, 120)})`
            : "products.json serves an empty product list";
      } catch {
        shopify = "products.json served but is not JSON";
      }
    } else {
      shopify = `products.json ${probe.source.status}`;
    }
  } catch {
    shopify = "products.json fetch failed";
  }
  return { pages, shopify, apolloOnly: false };
}

export interface ClassifyCompanyInput {
  sectorId: string;
  companyId: string;
  call?: ClassifierCall;
  /** Test hook for fake-site URLs (production leaves it empty). */
  fetchOptions?: { privateHostAllowlist?: string[] };
  /**
   * Worker-owned run row (created running by the feeder so the item links
   * before the async drive starts). Created here when absent.
   */
  runId?: string;
}

/** Insert a running sector-preflight run row for the feeder to link. */
export async function createSectorRun(db: Db, companyId: string): Promise<string> {
  const runId = randomUUID();
  await db.insert(researchRuns).values({
    id: runId,
    companyId,
    kind: "sector_preflight",
    status: "running",
    startedAt: new Date(),
    stage: "sector_preflight",
  });
  return runId;
}

export interface ClassifyCompanyOutcome {
  runId: string;
  classification: Classification;
  verification: "verified" | "doc_only" | "unverified" | "quote_mismatch" | "verified_value";
  apolloOnly: boolean;
}

/** Classify one company; throws (and fails the run) when the call or schema fails. */
export async function classifyCompany(db: Db, input: ClassifyCompanyInput): Promise<ClassifyCompanyOutcome> {
  const call = input.call ?? dockerClassifierCall;
  const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  const runId = input.runId ?? (await createSectorRun(db, company.id));
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new Error("sector run row is gone");
  const fail = async (error: string): Promise<never> => {
    await db
      .update(researchRuns)
      .set({ status: "failed", error: error.slice(0, 500), finishedAt: new Date() })
      .where(eq(researchRuns.id, runId));
    throw new DomainError("invalid_input", error);
  };
  const profile = await getProfile(db, input.sectorId);
  const fetched = await fetchInputs(db, runId, company, input.fetchOptions ?? {});
  const prompt = buildClassifierPrompt(
    {
      company,
      description: apolloDescription(company),
      pages: fetched.pages,
      shopify: fetched.shopify,
      apolloOnly: fetched.apolloOnly,
    },
    profile,
  );
  let result: ClassifierCallResult;
  const started = Date.now();
  try {
    result = await call({ runId, prompt, schema: classifierSchemaFor(profile) });
  } catch (err) {
    return fail(`classifier call failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const durationMs = Date.now() - started;
  let classification: Classification;
  try {
    classification = parseClassification(result.json, profile);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "invalid classification");
  }
  if (fetched.apolloOnly && classification.confidence !== "low") {
    return fail("invalid classification: Apollo-only input requires low confidence");
  }
  await logClassifierCall(db, { ...run, status: "running" } as ResearchRun, {
    seq: 1,
    prompt,
    raw: result.raw,
    json: result.json,
    usage: result.usage,
    durationMs,
  });
  // Quote grounding like Stage 4.3; no agent docs exist, so the verdict is
  // verified (in the cited source text), quote_mismatch, or unverified.
  const verification = await verifyQuote(
    db,
    { quote: classification.quote, quoteSourceId: classification.quote_source_id, isConsistent: () => true },
    [],
    new Map(),
  );
  const usage = result.usage;
  await db
    .update(researchRuns)
    .set({
      status: "succeeded",
      finishedAt: new Date(),
      agentUsage: usage
        ? {
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: usage.cachedTokens,
            reasoningTokens: usage.reasoningTokens,
            calls: usage.calls,
            childrenIncluded: false,
          }
        : null,
    })
    .where(eq(researchRuns.id, runId));
  await db
    .insert(sectorPreflight)
    .values({
      id: randomUUID(),
      sectorId: input.sectorId,
      companyId: company.id,
      runId,
      businessType: classification.business_type,
      primaryCategory: classification.primary_category,
      sellsOwnProducts: classification.sells_own_products,
      hasOnlineStore: classification.has_online_store,
      shipsTo: classification.ships_to,
      confidence: classification.confidence,
      reason: classification.reason,
      quote: classification.quote,
      quoteSourceId: classification.quote_source_id,
      verification,
      promptVersion: "v2",
      profileHash: profileHash(profile),
    })
    .onConflictDoUpdate({
      target: [sectorPreflight.sectorId, sectorPreflight.companyId],
      set: {
        runId,
        businessType: classification.business_type,
        primaryCategory: classification.primary_category,
        sellsOwnProducts: classification.sells_own_products,
        hasOnlineStore: classification.has_online_store,
        shipsTo: classification.ships_to,
        confidence: classification.confidence,
        reason: classification.reason,
        quote: classification.quote,
        quoteSourceId: classification.quote_source_id,
        verification,
        promptVersion: "v2",
        profileHash: profileHash(profile),
        updatedAt: new Date(),
      },
    });
  return { runId, classification, verification, apolloOnly: fetched.apolloOnly };
}
