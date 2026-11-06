import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { sources } from "../../db/schema.js";

export const REDIRECT_REPAIR_VERSION = "same-site-redirect-v1";
const REDIRECT_ERROR = "redirect outside the allowed site or path";
type Evidence = { status: string; httpStatus: number | null; error: string | null; url?: string };
export function websiteEvidenceBlocked(evidence: Evidence[]) {
  return evidence.some(row => row.status === "blocked" || row.status === "robots_disallowed" ||
    (row.httpStatus !== null && ([401, 403, 406, 418].includes(row.httpStatus) || row.httpStatus >= 500)) ||
    row.error === "redirect disallowed by robots.txt");
}

/** Absence of a block is not proof of the redirect bug: require its exact stored error. */
export function redirectRepairEligible(evidence: Evidence[]) {
  const blocked = websiteEvidenceBlocked(evidence);
  const failed = evidence.filter(row => row.status !== "ok" && row.status !== "not_found");
  return !blocked && failed.some(row => row.error === REDIRECT_ERROR && row.httpStatus === null) &&
    failed.every(row => row.httpStatus === null && [REDIRECT_ERROR, "robots.txt unavailable"].includes(row.error ?? ""));
}

/** Retry ordinary page/network failures, never a blocked or failed robots request. */
export function transientWebsiteRetryEligible(prior: { status: string; clientStatus: string | null }, evidence: Evidence[]) {
  if (prior.status !== "fetch_error" && prior.clientStatus !== "fetch_error") return false;
  return !websiteEvidenceBlocked(evidence) && !evidence.some(row => {
    if (row.error === "robots.txt unavailable" || row.error === REDIRECT_ERROR) return true;
    try { return new URL(row.url ?? "").pathname === "/robots.txt" && !["ok", "not_found"].includes(row.status); }
    catch { return false; }
  });
}

/** Follow company citations back to library pages and the exact stored robots request. No fetching. */
export async function websiteRetryEvidence(db: Db, sourceIds: string[]) {
  if (!sourceIds.length) return [];
  const citations = await db.select().from(sources).where(inArray(sources.id, sourceIds));
  const pageIds = citations.flatMap(row => typeof row.details?.siteSourceId === "string" ? [row.details.siteSourceId] : []);
  const pages = pageIds.length ? await db.select().from(sources).where(inArray(sources.id, pageIds)) : [];
  const robots = [];
  for (const page of pages) {
    if (page.error !== "robots.txt unavailable") continue;
    let [robot] = await db.select().from(sources).where(and(eq(sources.runId, page.runId),
      eq(sources.url, new URL("/robots.txt", page.url).href))).orderBy(desc(sources.fetchedAt)).limit(1);
    if (!robot) [robot] = await db.select().from(sources).where(and(eq(sources.companyId, page.companyId),
      eq(sources.url, new URL("/robots.txt", page.url).href), lte(sources.fetchedAt, page.fetchedAt)))
      .orderBy(desc(sources.fetchedAt)).limit(1);
    if (robot && page.fetchedAt.getTime() - robot.fetchedAt.getTime() > 3_600_000) continue;
    if (robot) robots.push(robot);
  }
  const hosts = new Set([...citations, ...pages].flatMap(row => {
    try { return [new URL(row.url).hostname.replace(/^www\./, "")]; } catch { return []; }
  }));
  const companyIds = [...new Set([...citations, ...pages].map(row => row.companyId))];
  const previous = await db.select().from(sources).where(and(inArray(sources.companyId, companyIds), eq(sources.collector, "website_software")));
  const history = previous.filter(row => {
    try { return hosts.has(new URL(row.url).hostname.replace(/^www\./, "")); } catch { return false; }
  });
  // Old soft network errors do not explain the current result. Hard blocks
  // remain authoritative across runs, aliases and cache-key changes.
  return [...citations, ...pages, ...robots, ...history.filter(row => websiteEvidenceBlocked([row]))];
}
