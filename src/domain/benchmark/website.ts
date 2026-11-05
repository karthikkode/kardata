import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { records, researchRuns, sources } from "../../db/schema.js";
import { collectWebsiteSoftware, WEBSITE_SCAN_TYPE, WEBSITE_SOFTWARE_COLLECTOR,
  websiteVendorConfig, type WebsiteVendorConfig } from "../../collect/collectors/website-software.js";
import { fetchUrl } from "../../collect/fetch.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import { DomainError } from "../errors.js";
import { findEvidenceLibrary } from "../evidence-library.js";
import { blobText } from "../research/reads.js";
import { upsertRecords } from "../research/records.js";
import { lockEvidence } from "../sec-adv/evidence.js";
import { activeMembers } from "../sec-adv/snapshot.js";
import { sectorData } from "./sector-data.js";
import { websiteCheckKey, websiteInputs } from "./website-input.js";

type Scan = Awaited<ReturnType<typeof collectWebsiteSoftware>>;
const scansInFlight = new WeakMap<Db, Map<string, Promise<Scan>>>();

async function scanSite(db: Db, key: string, companyId: string, homepage: URL, config: WebsiteVendorConfig) {
  let pending = scansInFlight.get(db);
  if (!pending) {
    pending = new Map();
    scansInFlight.set(db, pending);
  }
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const [cached] = await db.select().from(sources).where(and(eq(sources.companyId, companyId),
      eq(sources.collector, WEBSITE_SOFTWARE_COLLECTOR), sql`${sources.details}->>'scanKey' = ${key}`))
      .orderBy(desc(sources.fetchedAt)).limit(1);
    if (cached) {
      const result = cached.details?.result as Omit<Scan, "pages">;
      const ids = cached.details?.pageIds as string[];
      const pages = await Promise.all(ids.map(async id => (await db.select().from(sources).where(eq(sources.id, id)))[0]!));
      return { ...result, pages };
    }
    const runId = randomUUID();
    const now = new Date();
    await db.insert(researchRuns).values({ id: runId, companyId, kind: "manual", status: "succeeded",
      createdBy: WEBSITE_SOFTWARE_COLLECTOR, startedAt: now, finishedAt: now });
    const scan = await collectWebsiteSoftware(db, { companyId, runId, homepage, config }, async (db, request) => {
      if (request.url !== homepage.href) return fetchUrl(db, request);
      const [successfulHome] = await db.select().from(sources).where(and(eq(sources.companyId, companyId),
        eq(sources.collector, WEBSITE_SOFTWARE_COLLECTOR), sql`${sources.details}->>'homepageScanKey' = ${key}`)).limit(1);
      if (successfulHome?.blobSha256) {
        const body = await blobText(db, successfulHome.blobSha256);
        if (body) return { source: successfulHome, ...body };
      }
      const page = await fetchUrl(db, request);
      if (page.source.status === "ok" && page.source.blobSha256) {
        await db.update(sources).set({ details: { homepageScanKey: key } }).where(eq(sources.id, page.source.id));
      }
      return page;
    });
    const { pages, ...result } = scan;
    if (result.status !== "fetch_error" && result.clientStatus !== "fetch_error") {
      await db.update(sources).set({ details: { scanKey: key, result, pageIds: pages.map(page => page.id) } })
        .where(eq(sources.id, pages[0]!.id));
    }
    return scan;
  })().finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

export async function runWebsiteSoftware(db: Db, input: {
  sectorId: string; companyIds?: string[]; afterCompanyId?: string; limit?: number; concurrency?: number;
}) {
  const config = websiteVendorConfig.parse(await sectorData(db, input.sectorId, "website-vendors.json"));
  const library = await findEvidenceLibrary(db);
  if (!library) throw new DomainError("invalid_input", "run evidence_library_ensure first");
  const members = await activeMembers(db, input.sectorId);
  const ids = input.companyIds && new Set(input.companyIds);
  const selected = ids ? members.filter(row => ids.has(row.id)) :
    members.filter(row => !input.afterCompanyId || row.id > input.afterCompanyId).slice(0, input.limit ?? 50);
  if (ids && selected.length !== ids.size) throw new DomainError("invalid_input", "selected companies must be active sector members");
  const inputs = await websiteInputs(db, selected.map(row => row.id), config);
  const results: { companyId: string; status: string; cached: boolean; checked?: boolean; reason?: string }[] = [];
  const queue = [...selected];
  await Promise.all(Array.from({ length: input.concurrency ?? 4 }, async () => {
    for (let member = queue.shift(); member; member = queue.shift()) {
      const companyId = member.id;
      try {
        const site = inputs.get(companyId)!;
        const { home } = site;
        const key = websiteCheckKey(config, site);
        if (key === null) {
          results.push({ companyId, status: "shared_domain", cached: false, checked: false,
            reason: "Company domain is shared; no firm-specific website evidence was collected" });
          continue;
        }
        const [known] = await db.select({ data: records.data, sourceIds: records.sourceIds }).from(records).where(and(eq(records.companyId, companyId),
          eq(records.type, WEBSITE_SCAN_TYPE), sql`${records.data}->>'check_key' = ${key}`));
        const prior = known?.data.result as { status: string; clientStatus: string | null } | undefined;
        if (prior && prior.status !== "fetch_error" && prior.clientStatus !== "fetch_error") {
          results.push({ companyId, status: prior.status, cached: true });
          continue;
        }
        // Earlier scans classified an unavailable robots file as a generic fetch error.
        // Retain that evidence instead of retrying a robots failure or HTTP 403.
        if (prior && known?.sourceIds.length) {
          const evidence = await db.select({ status: sources.status, error: sources.error, httpStatus: sources.httpStatus })
            .from(sources).where(inArray(sources.id, known.sourceIds));
          const blocked = evidence.some(row => row.status === "blocked" || row.httpStatus === 403);
          const robots = evidence.some(row => row.status === "robots_disallowed" || row.error === "robots.txt unavailable");
          if (blocked || robots) {
            results.push({ companyId, status: prior.status === "found" ? "found" : blocked ? "blocked" : "robots_unavailable",
              cached: true, reason: "Stored block or robots evidence is not retried" });
            continue;
          }
        }
        const scan = home ? await scanSite(db, key, library.companyId, home, config) :
          { status: "missing_site", clientStatus: null, pages: [], signals: [] };
        await db.transaction(async tx => {
          await lockEvidence(tx, `company:${companyId}:website-software`);
          const [current] = await tx.select({ data: records.data }).from(records).where(and(eq(records.companyId, companyId),
            eq(records.type, WEBSITE_SCAN_TYPE), sql`${records.data}->>'check_key' = ${key}`));
          const saved = current?.data.result as { status: string; clientStatus: string | null } | undefined;
          if (saved && saved.status !== "fetch_error" && saved.clientStatus !== "fetch_error") return;
          const runId = await getOrCreateManualRun(tx, companyId);
          const evidence = scan.pages.length ? scan.pages.map(page => ({
            id: randomUUID(), companyId, runId, collector: WEBSITE_SOFTWARE_COLLECTOR,
            url: page.url, finalUrl: page.finalUrl, status: page.status, httpStatus: page.httpStatus, error: page.error,
            fetchedAt: page.fetchedAt, blobSha256: page.blobSha256, details: { siteSourceId: page.id },
          })) : [{
            id: randomUUID(), companyId, runId, collector: WEBSITE_SOFTWARE_COLLECTOR,
            url: "kardata:benchmark/website-software", finalUrl: "kardata:benchmark/website-software",
            status: "not_found" as const, error: "no usable company homepage",
          }];
          await tx.insert(sources).values(evidence);
          const { pages, ...result } = scan;
          const [written] = await upsertRecords(tx, { companyId, runId, createdBy: WEBSITE_SOFTWARE_COLLECTOR, records: [{
            type: WEBSITE_SCAN_TYPE, naturalKey: ["check_key"], sourceIds: evidence.map(source => source.id),
            data: { check_key: key, result: { ...result, homepage: home?.href ?? null, inputKind: site.kind, checkedAt: new Date().toISOString(),
              pages: pages.map(page => ({ url: page.finalUrl, status: page.status, httpStatus: page.httpStatus })) } },
          }] });
          if (!written?.ok) throw new Error(written?.error ?? "website result was not saved");
        });
        results.push({ companyId, status: scan.status, cached: false });
      } catch (error) {
        results.push({ companyId, status: "fetch_error", cached: false,
          reason: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
      }
    }
  }));
  return { results: results.sort((a, b) => a.companyId.localeCompare(b.companyId)),
    uncheckedSharedDomain: results.filter(row => row.status === "shared_domain").length,
    nextCompanyId: selected.at(-1)?.id ?? null };
}
