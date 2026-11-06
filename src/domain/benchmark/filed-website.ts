import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { facts, records, sources } from "../../db/schema.js";
import { companyHomepage, websiteVendorConfig } from "../../collect/collectors/website-software.js";
import { effectiveCompanies } from "../effective.js";
import { DomainError } from "../errors.js";
import { addFacts } from "../research/facts.js";
import { isValidDateString } from "../research/validate.js";
import { activeMembers } from "../sec-adv/snapshot.js";
import { lockEvidence, SCHEDULE_COLLECTOR } from "../sec-adv/evidence.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import { loadBrochureEvidence } from "./brochure-review.js";
import { sectorData } from "./sector-data.js";
import { websiteInputs } from "./website-input.js";
import { coverWebsiteQuote, FILED_WEBSITE_COLLECTOR, FILED_WEBSITE_KEY, FILED_WEBSITE_VERSION, websiteHost } from "./website-address.js";

export async function promoteFiledWebsites(db: Db, input: {
  sectorId: string; companyIds?: string[]; afterCompanyId?: string; limit?: number; dryRun?: boolean;
}) {
  const config = websiteVendorConfig.parse(await sectorData(db, input.sectorId, "website-vendors.json"));
  const extra = z.object({ excludedHosts: z.array(z.string()) }).parse(await sectorData(db, input.sectorId, "website-promotion.json"));
  const promotionConfig = { ...config, excludedHosts: [...config.excludedHosts, ...extra.excludedHosts] };
  const members = await activeMembers(db, input.sectorId);
  const ids = input.companyIds ? new Set(input.companyIds) : null;
  const selected = (ids ? members.filter(row => ids.has(row.id)) : members.filter(row => !input.afterCompanyId || row.id > input.afterCompanyId)
    .slice(0, input.limit ?? 50));
  if (ids && selected.length !== ids.size) throw new DomainError("invalid_input", "select distinct active sector companies");
  const all = await db.select().from(records).where(and(eq(records.type, "sec_adv_schedules"), eq(records.createdBy, SCHEDULE_COLLECTOR)));
  const effective = effectiveCompanies(db);
  const directory = await db.select({ id: effective.id, website: effective.website, domain: effective.domain }).from(effective);
  const owners = new Map<string, Set<string>>();
  const claim = (id: string, value: unknown) => {
    const home = typeof value === "string" ? companyHomepage(value, promotionConfig) : null;
    if (!home) return;
    const host = websiteHost(home), claims = owners.get(host) ?? new Set<string>();
    claims.add(id); owners.set(host, claims);
  };
  for (const company of directory) { claim(company.id, company.website); claim(company.id, company.domain); }
  for (const row of all) if (Array.isArray(row.data.websites)) for (const address of row.data.websites) claim(row.companyId, address);
  const current = await websiteInputs(db, selected.map(row => row.id), config);
  const results: { companyId: string; outcome: string; url?: string; filingDate?: string; sourceIds?: string[] }[] = [];
  let written = 0;
  for (const member of selected) {
    const report = (outcome: string) => results.push({ companyId: member.id, outcome });
    const existingInput = current.get(member.id);
    if (existingInput?.home && !existingInput.shared && existingInput.kind !== "filed") { report("current_input_usable"); continue; }
    const filing = all.filter(row => row.companyId === member.id && typeof row.data.filing_date === "string" &&
      isValidDateString(row.data.filing_date)).sort((a, b) => String(b.data.filing_date).localeCompare(String(a.data.filing_date)))[0];
    if (!filing || !Array.isArray(filing.data.websites)) { report("no_filed_addresses"); continue; }
    const date = filing.data.filing_date as string;
    const citations = filing.sourceIds.length ? await db.select().from(sources).where(eq(sources.id, filing.sourceIds[0]!)) : [];
    if (!citations.some(row => row.companyId === member.id && row.collector === SCHEDULE_COLLECTOR &&
      member.crd && row.details?.crd === member.crd && row.details?.filingId === filing.data.filing_id &&
      row.details?.verification === "verified" && row.details?.filingDate === date)) { report("unverified_filing"); continue; }
    const candidates = new Map<string, URL>();
    for (const address of filing.data.websites) {
      const home = typeof address === "string" ? companyHomepage(address, promotionConfig) : null;
      if (home && owners.get(websiteHost(home))?.size === 1) candidates.set(websiteHost(home), home);
    }
    const evidence = await loadBrochureEvidence(db, member.id);
    const covers = evidence.passages.filter(row => row.kind === "firm" && row.page === 1);
    const newest = covers.map(row => row.date).sort().at(-1);
    const corroborated = [...candidates].flatMap(([host, home]) => {
      const cover = covers.find(row => row.date === newest && coverWebsiteQuote(row.text, host));
      return cover ? [{ home, host, cover, quote: coverWebsiteQuote(cover.text, host)! }] : [];
    });
    if (corroborated.length !== 1) { report(corroborated.length ? "multiple_corroborated_hosts" : "no_unshared_corroborated_host"); continue; }
    const candidate = corroborated[0]!;
    const sourceIds = [...new Set([...filing.sourceIds, candidate.cover.sourceId])];
    const digest = createHash("sha256").update(JSON.stringify([filing.id, candidate.home.href, candidate.cover.sourceId, candidate.cover.date])).digest("hex");
    const qualifiers = { version: FILED_WEBSITE_VERSION, input: digest };
    const [saved] = await db.select().from(facts).where(and(eq(facts.companyId, member.id), eq(facts.key, FILED_WEBSITE_KEY),
      eq(facts.createdBy, FILED_WEBSITE_COLLECTOR))).orderBy(desc(facts.asOf), desc(facts.createdAt), desc(facts.id)).limit(1);
    if (saved?.qualifiers.input === digest || (saved?.asOf && saved.asOf > date)) { report("unchanged_or_newer"); continue; }
    if (input.dryRun === false) written += await db.transaction(async tx => {
      await lockEvidence(tx, `company:${member.id}:filed-website`);
      const [existing] = await tx.select().from(facts).where(and(eq(facts.companyId, member.id), eq(facts.key, FILED_WEBSITE_KEY),
        eq(facts.createdBy, FILED_WEBSITE_COLLECTOR))).orderBy(desc(facts.asOf), desc(facts.createdAt), desc(facts.id)).limit(1);
      if (existing?.qualifiers.input === digest || (existing?.asOf && existing.asOf > date)) return 0;
      const [saved] = await addFacts(tx, { companyId: member.id, createdBy: FILED_WEBSITE_COLLECTOR,
        runId: await getOrCreateManualRun(tx, member.id), facts: [{ key: FILED_WEBSITE_KEY, qualifiers, asOf: date,
          sourceIds, confidence: "high", quote: candidate.quote, quoteSourceId: candidate.cover.sourceId,
          value: { url: candidate.home.href, host: candidate.host, filingDate: date, filingId: filing.data.filing_id,
            filedAddresses: (filing.data.websites as unknown[]).filter(address => {
              const home = typeof address === "string" ? companyHomepage(address, promotionConfig) : null;
              return home && websiteHost(home) === candidate.host;
            }),
            brochureDate: candidate.cover.date, brochureSourceId: candidate.cover.sourceId, brochurePage: 1,
            quote: candidate.quote, verifiedBy: "unique filed host and stored brochure cover", promotedAt: new Date().toISOString() } }] });
      if (!saved?.ok) throw new Error(saved?.error ?? "filed website fact was not saved");
      return 1;
    });
    results.push({ companyId: member.id, outcome: input.dryRun === false ? "promoted" : "candidate", url: candidate.home.href,
      filingDate: date, sourceIds });
  }
  return { dryRun: input.dryRun !== false, selected: selected.length, written, results, nextCompanyId: selected.at(-1)?.id ?? null };
}
