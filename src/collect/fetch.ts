import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { gzipSync } from "node:zlib";
import { and, eq, sql } from "drizzle-orm";
import { blobs, researchRuns, sources, type Source } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { DomainError } from "../domain/errors.js";
import { recordEvent } from "./db.js";

// The only module allowed to call fetch (enforced by eslint no-restricted-globals).

// robots-parser's bundled types don't resolve under NodeNext, so load it via
// require with a local interface matching its documented API.
interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
  getPreferredHost(): string | null;
}

const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (url: string, robotstxt: string) => Robot;

export const FETCH_TIMEOUT_MS = 15000;
export const FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const FETCH_MAX_REDIRECTS = 5;
export const HOST_DELAY_MS = 2000;

// Ops/test knob for the per-host delay. Production leaves it unset (2000 ms);
// collector tests point every endpoint at one fake host and set it low.
export function hostDelayMs(): number {
  const raw = process.env.KARDATA_HOST_DELAY_MS;
  if (raw === undefined || raw === "") return HOST_DELAY_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : HOST_DELAY_MS;
}
export const RUN_REQUEST_BUDGET = 80;
const ROBOTS_TTL_MS = 60 * 60 * 1000;
const ROBOTS_CACHE_MAX = 2000;
const HOST_STAMP_MAX = 2000;

export function contactUrl(): string {
  const fromEnv = process.env.KARDATA_CONTACT_URL?.trim();
  return fromEnv ? fromEnv : "https://github.com/karthikkode/kardata";
}

export function userAgent(): string {
  return `KardataBot/0.1 (+${contactUrl()})`;
}

export class BudgetExceededError extends Error {
  constructor() {
    super(`request budget exceeded (${RUN_REQUEST_BUDGET} requests)`);
    this.name = "BudgetExceededError";
  }
}

class FetchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchFailedError";
  }
}

class SsrfRefusedError extends Error {
  constructor(hostname: string) {
    super(`refused: ${hostname} resolves to a non-public address`);
    this.name = "SsrfRefusedError";
  }
}

// ---- SSRF guard ----

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    n = n * 256 + value;
  }
  return n >>> 0;
}

function isPrivateIpv4(n: number): boolean {
  return (
    n >>> 24 === 10 || // 10/8
    n >>> 20 === 0xac1 || // 172.16/12
    n >>> 16 === 0xc0a8 || // 192.168/16
    n >>> 24 === 127 || // loopback
    n >>> 16 === 0xa9fe || // 169.254/16 link-local + metadata
    n >>> 24 === 0 // 0/8
  );
}

function isPublicIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice("::ffff:".length);
    if (rest.includes(".")) {
      const n = ipv4ToInt(rest);
      return n !== null && !isPrivateIpv4(n);
    }
    const groups = rest.split(":");
    if (groups.length === 2) {
      const hi = Number.parseInt(groups[0] ?? "", 16);
      const lo = Number.parseInt(groups[1] ?? "", 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        return !isPrivateIpv4((hi * 65536 + lo) >>> 0);
      }
    }
    return false;
  }
  if (isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    return n !== null && !isPrivateIpv4(n);
  }
  if (isIP(ip) === 6) {
    if (lower === "::1" || lower === "::") return false;
    const first = lower.split(":")[0] ?? "";
    const group = Number.parseInt(first === "" ? "0" : first, 16);
    if (Number.isNaN(group)) return false;
    if ((group & 0xffc0) === 0xfe80) return false; // link-local
    if ((group & 0xfe00) === 0xfc00) return false; // unique-local
    return true;
  }
  return false;
}

/**
 * Refuse private, loopback, link-local and metadata addresses. Literal IPs are
 * checked directly; hostnames resolve first and every answer must be public.
 * Exact `allowlist` matches skip the check (a test hatch; production passes none).
 * Note: check-then-fetch has an inherent DNS-rebinding TOCTOU; pinning sockets
 * per resolution is out of scope for this stage.
 */
export async function assertPublicHost(hostname: string, allowlist: string[]): Promise<void> {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (allowlist.some((entry) => entry.toLowerCase().replace(/\.$/, "") === host)) return;
  if (isIP(host) !== 0) {
    if (!isPublicIp(host)) throw new SsrfRefusedError(hostname);
    return;
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new FetchFailedError(`cannot resolve host: ${hostname}`);
  }
  for (const entry of addresses) {
    if (!isPublicIp(entry.address)) throw new SsrfRefusedError(hostname);
  }
}

// ---- Per-host rate limit (global across concurrent runs) ----

interface HostSlot {
  tail: Promise<void>;
  active: number;
}

const hostSlots = new Map<string, HostSlot>();
const lastFetchAt = new Map<string, number>();

function stampHost(host: string): void {
  lastFetchAt.delete(host);
  lastFetchAt.set(host, Date.now());
  while (lastFetchAt.size > HOST_STAMP_MAX) {
    const oldest = lastFetchAt.keys().next().value;
    if (oldest === undefined) break;
    lastFetchAt.delete(oldest);
  }
}

async function withHostSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const slot = hostSlots.get(host) ?? { tail: Promise.resolve(), active: 0 };
  slot.active += 1;
  const prev = slot.tail;
  let done!: () => void;
  const gate = new Promise<void>((resolve) => {
    done = resolve;
  });
  slot.tail = prev.then(() => gate);
  hostSlots.set(host, slot);
  await prev;
  try {
    const delay = hostDelayMs();
    const wait = Math.max(0, delay - (Date.now() - (lastFetchAt.get(host) ?? 0)));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    stampHost(host);
    return await fn();
  } finally {
    done();
    slot.active -= 1;
    if (slot.active <= 0) hostSlots.delete(host);
  }
}

// ---- Budget ----

async function reserveRequestSlot(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(researchRuns)
    .set({ requestCount: sql`${researchRuns.requestCount} + 1` })
    .where(and(eq(researchRuns.id, runId), sql`${researchRuns.requestCount} < ${RUN_REQUEST_BUDGET}`))
    .returning({ id: researchRuns.id });
  return rows.length > 0;
}

// ---- robots.txt (cached per host, 1 hour) ----

interface RobotsEntry {
  rules: ReturnType<typeof robotsParser> | null;
  body: string;
  fetchedAt: number;
}

const robotsCache = new Map<string, RobotsEntry>();

function cacheRobots(key: string, entry: RobotsEntry): void {
  robotsCache.delete(key);
  robotsCache.set(key, entry);
  while (robotsCache.size > ROBOTS_CACHE_MAX) {
    const oldest = robotsCache.keys().next().value;
    if (oldest === undefined) break;
    robotsCache.delete(oldest);
  }
}

function statusForHttp(status: number): "ok" | "not_found" | "blocked" | "error" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "not_found";
  if (status === 403 || status === 429 || status === 503) return "blocked";
  return "error";
}

export interface FetchOptions {
  accept?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  privateHostAllowlist?: string[];
  // Extra request headers (e.g. Authorization). Never persisted to sources/events.
  headers?: Record<string, string>;
}

interface ResolvedFetchOptions {
  accept: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  privateHostAllowlist: string[];
  headers: Record<string, string>;
}

interface RawResponse {
  status: number;
  contentType: string | null;
  body: Buffer;
  finalUrl: string;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchFailedError(`response too large (over ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function performRequest(startUrl: string, opts: ResolvedFetchOptions): Promise<RawResponse> {
  let current = startUrl;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw new FetchFailedError("invalid redirect URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new FetchFailedError("redirect to non-http URL refused");
    }
    await assertPublicHost(url.hostname, opts.privateHostAllowlist);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs),
        headers: { "user-agent": userAgent(), accept: opts.accept, ...opts.headers },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new FetchFailedError(`timeout after ${opts.timeoutMs}ms`);
      }
      throw new FetchFailedError(err instanceof Error ? err.message : String(err));
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (res.body) await res.body.cancel().catch(() => {});
      if (!location) throw new FetchFailedError(`redirect without location (HTTP ${res.status})`);
      try {
        current = new URL(location, current).href;
      } catch {
        throw new FetchFailedError("invalid redirect URL");
      }
      continue;
    }
    const contentLength = res.headers.get("content-length");
    if (
      contentLength !== null &&
      /^\d+$/.test(contentLength.trim()) &&
      Number(contentLength) > opts.maxBytes
    ) {
      if (res.body) await res.body.cancel().catch(() => {});
      throw new FetchFailedError(`response too large (over ${opts.maxBytes} bytes)`);
    }
    const body = await readCapped(res, opts.maxBytes);
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
      body,
      finalUrl: current,
    };
  }
  throw new FetchFailedError(`too many redirects (over ${opts.maxRedirects})`);
}

type SourceStatus = "ok" | "not_found" | "blocked" | "robots_disallowed" | "error";

interface SourceInput {
  runId: string;
  companyId: string;
  collector: string;
  url: string;
  finalUrl: string;
  status: SourceStatus;
  httpStatus?: number | null;
  error?: string | null;
  blob?: { body: Buffer; contentType: string | null };
}

async function writeSource(db: Db, input: SourceInput): Promise<Source> {
  let blobSha256: string | null = null;
  let bytes = 0;
  if (input.blob) {
    blobSha256 = createHash("sha256").update(input.blob.body).digest("hex");
    await db
      .insert(blobs)
      .values({
        sha256: blobSha256,
        contentType: input.blob.contentType,
        size: input.blob.body.byteLength,
        gzip: gzipSync(input.blob.body),
      })
      .onConflictDoNothing();
    bytes = input.blob.body.byteLength;
  }
  const [source] = await db
    .insert(sources)
    .values({
      id: randomUUID(),
      companyId: input.companyId,
      runId: input.runId,
      url: input.url,
      finalUrl: input.finalUrl,
      collector: input.collector,
      status: input.status,
      httpStatus: input.httpStatus ?? null,
      error: input.error ? input.error.slice(0, 500) : null,
      blobSha256,
    })
    .returning();
  if (!source) throw new Error("source insert returned no row");
  await recordEvent(db, input.runId, "fetch", {
    url: input.url,
    finalUrl: input.finalUrl,
    collector: input.collector,
    status: input.status,
    httpStatus: input.httpStatus ?? null,
    error: input.error ? input.error.slice(0, 200) : null,
    bytes,
  });
  return source;
}

async function ensureRobots(
  db: Db,
  runId: string,
  companyId: string,
  collector: string,
  target: URL,
  opts: ResolvedFetchOptions,
): Promise<RobotsEntry> {
  const key = `${target.protocol}//${target.host}`;
  const cached = robotsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached;
  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
  let entry: RobotsEntry;
  try {
    if (!(await reserveRequestSlot(db, runId))) throw new BudgetExceededError();
    const res = await withHostSlot(target.host, () => performRequest(robotsUrl, opts));
    if (res.status >= 200 && res.status < 300) {
      const body = res.body.toString("utf8");
      entry = { rules: robotsParser(robotsUrl, body), body, fetchedAt: Date.now() };
      await writeSource(db, {
        runId,
        companyId,
        collector,
        url: robotsUrl,
        finalUrl: res.finalUrl,
        status: "ok",
        httpStatus: res.status,
        blob: { body: res.body, contentType: res.contentType },
      });
    } else {
      entry = { rules: null, body: "", fetchedAt: Date.now() };
      await writeSource(db, {
        runId,
        companyId,
        collector,
        url: robotsUrl,
        finalUrl: res.finalUrl,
        status: statusForHttp(res.status),
        httpStatus: res.status,
      });
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    entry = { rules: null, body: "", fetchedAt: Date.now() };
    await writeSource(db, {
      runId,
      companyId,
      collector,
      url: robotsUrl,
      finalUrl: robotsUrl,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  cacheRobots(key, entry);
  return entry;
}

const CHALLENGE_TITLE =
  /<title[^>]*>\s*(just a moment|attention required|verify you are human|please verify you|one more step|are you a robot|human verification|incapsula incident)/i;

function isChallengePage(text: string): boolean {
  if (text.includes("cf-chl")) return true; // Cloudflare interactive challenge loader
  if (text.includes("challenges.cloudflare.com")) return true; // Cloudflare managed challenge
  if (text.includes("_Incapsula_Resource") || /incapsula incident/i.test(text)) return true;
  if (text.includes("px-captcha")) return true; // PerimeterX captcha
  return CHALLENGE_TITLE.test(text.slice(0, 20000));
}

export interface FetchRequest extends FetchOptions {
  runId: string;
  companyId: string;
  collector: string;
  url: string;
}

export interface FetchResult {
  source: Source;
  body?: Buffer;
  text?: string;
}

function resolveOptions(req: FetchRequest): ResolvedFetchOptions {
  return {
    accept: req.accept ?? "text/html,application/json;q=0.9,*/*;q=0.8",
    timeoutMs: req.timeoutMs ?? FETCH_TIMEOUT_MS,
    maxBytes: req.maxBytes ?? FETCH_MAX_BYTES,
    maxRedirects: req.maxRedirects ?? FETCH_MAX_REDIRECTS,
    privateHostAllowlist: req.privateHostAllowlist ?? [],
    headers: req.headers ?? {},
  };
}

export async function fetchUrl(db: Db, req: FetchRequest): Promise<FetchResult> {
  const run = await db.query.researchRuns.findFirst({ where: eq(researchRuns.id, req.runId) });
  if (!run) throw new DomainError("not_found", `run not found: ${req.runId}`);
  const opts = resolveOptions(req);
  const base = {
    runId: req.runId,
    companyId: req.companyId,
    collector: req.collector,
    url: req.url,
    finalUrl: req.url,
  };
  const fail = async (message: string): Promise<FetchResult> => ({
    source: await writeSource(db, { ...base, status: "error", error: message }),
  });

  let target: URL;
  try {
    target = new URL(req.url);
  } catch {
    return fail("invalid URL");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return fail("only http(s) URLs are allowed");
  }
  try {
    await assertPublicHost(target.hostname, opts.privateHostAllowlist);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  let robots: RobotsEntry;
  try {
    robots = await ensureRobots(db, req.runId, req.companyId, req.collector, target, opts);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await writeSource(db, { ...base, status: "error", error: err.message });
      throw err;
    }
    throw err;
  }
  if (robots.rules && robots.rules.isDisallowed(target.href, userAgent()) === true) {
    const source = await writeSource(db, { ...base, status: "robots_disallowed" });
    return { source };
  }

  if (!(await reserveRequestSlot(db, req.runId))) {
    await writeSource(db, { ...base, status: "error", error: new BudgetExceededError().message });
    throw new BudgetExceededError();
  }

  let res: RawResponse;
  try {
    res = await withHostSlot(target.host, () => performRequest(target.href, opts));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const mapped = statusForHttp(res.status);
  if (mapped === "ok") {
    const text = res.body.toString("utf8");
    const contentType = res.contentType ?? "";
    if ((contentType === "" || /html/i.test(contentType)) && isChallengePage(text)) {
      const source = await writeSource(db, {
        ...base,
        finalUrl: res.finalUrl,
        status: "blocked",
        httpStatus: res.status,
      });
      return { source };
    }
    const source = await writeSource(db, {
      ...base,
      finalUrl: res.finalUrl,
      status: "ok",
      httpStatus: res.status,
      blob: { body: res.body, contentType: res.contentType },
    });
    return { source, body: res.body, text };
  }
  const source = await writeSource(db, {
    ...base,
    finalUrl: res.finalUrl,
    status: mapped,
    httpStatus: res.status,
  });
  return { source };
}

export interface RobotsTxt {
  body: string;
  sitemaps: string[];
}

/**
 * Read-through to the cached robots.txt (fetched on demand like any other URL).
 * Never writes on preamble failure; budget exhaustion still throws.
 */
export async function getRobotsTxt(db: Db, req: FetchRequest): Promise<RobotsTxt> {
  const run = await db.query.researchRuns.findFirst({ where: eq(researchRuns.id, req.runId) });
  if (!run) throw new DomainError("not_found", `run not found: ${req.runId}`);
  const opts = resolveOptions(req);
  let target: URL;
  try {
    target = new URL(req.url);
  } catch {
    return { body: "", sitemaps: [] };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { body: "", sitemaps: [] };
  }
  try {
    await assertPublicHost(target.hostname, opts.privateHostAllowlist);
  } catch {
    return { body: "", sitemaps: [] };
  }
  const entry = await ensureRobots(db, req.runId, req.companyId, req.collector, target, opts);
  return { body: entry.body, sitemaps: entry.rules ? entry.rules.getSitemaps() : [] };
}
