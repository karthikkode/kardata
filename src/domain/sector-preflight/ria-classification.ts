import { clearHeavyBookCache, refreshTierHeavyBooks, type TierBook } from "./ria-ranking.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, DbLike } from "../../db/client.js";
import { benchmarkFeeJobs, companies, facts, factsCurrent, imports, sectorCompanies, sectorPreflight, sectors } from "../../db/schema.js";
import { getImportDirs } from "../../lib/env.js";
import { decodeSecCsv, extractSecCsv, parseSecCsv } from "../../lib/sec/parse.js";
import { DomainError } from "../errors.js";
import { checkImportPaths, SEC_MAX_FILE_BYTES } from "../imports.js";
import { SNAPSHOT_COLLECTOR } from "../sec-adv/evidence.js";
import { normalizeCrd } from "../sec-adv/snapshot.js";
import { getProfile, profileHash } from "./profile.js";
import { evaluateRia, riaStoredReason, type RiaDecision, type RiaFacts, type RiaTier } from "./ria.js";

export interface RiaClassificationFilter {
  sectorId: string; decision?: RiaDecision; tier?: RiaTier; reason?: string;
  companyIds?: string[]; offset?: number; limit?: number;
}

export async function riaClassifications(db: DbLike, input: RiaClassificationFilter) {
  const where = and(eq(sectorCompanies.sectorId, input.sectorId),
    input.decision ? eq(sectorCompanies.riaDecision, input.decision) : undefined,
    input.tier !== undefined ? eq(sectorCompanies.riaTier, input.tier) : undefined,
    input.reason ? eq(sectorCompanies.eligibilityReason, input.reason) : undefined,
    input.companyIds ? inArray(sectorCompanies.companyId, input.companyIds) : undefined);
  const counts = await db.select({ decision: sectorCompanies.riaDecision, tier: sectorCompanies.riaTier,
    reason: sectorCompanies.eligibilityReason, count: sql<number>`count(*)::int` })
    .from(sectorCompanies).where(where)
    .groupBy(sectorCompanies.riaDecision, sectorCompanies.riaTier, sectorCompanies.eligibilityReason);
  const byDecision = { Accept: 0, Hold: 0, Reject: 0, unclassified: 0 };
  const byTier = { "0": 0, "1": 0, "2": 0 };
  const byReason: Record<string, number> = {};
  for (const row of counts) {
    byDecision[row.decision ?? "unclassified"] += Number(row.count);
    if (row.tier !== null) byTier[row.tier] += Number(row.count);
    if (row.reason) byReason[row.reason] = (byReason[row.reason] ?? 0) + Number(row.count);
  }
  const total = Object.values(byDecision).reduce((a, b) => a + b, 0);
  const offset = input.offset ?? 0, limit = input.limit ?? 100;
  const rows = await db.select({ companyId: sectorCompanies.companyId, decision: sectorCompanies.riaDecision,
    tier: sectorCompanies.riaTier, reason: sectorCompanies.eligibilityReason, registration: sectorCompanies.riaRegistration })
    .from(sectorCompanies).where(where).orderBy(sectorCompanies.companyId).limit(limit).offset(offset);
  return { sectorId: input.sectorId, total, byDecision, byTier, byReason, buckets: counts, rows,
    nextOffset: offset + limit < total ? offset + limit : null };
}

/** Read-only preservation evidence, including every saved benchmark revision and fee/review fact. */
export async function riaProtectedState(db: DbLike, sectorId: string) {
  const jobs = await db.select().from(benchmarkFeeJobs).where(eq(benchmarkFeeJobs.sectorId, sectorId)).orderBy(benchmarkFeeJobs.id);
  const fingerprint = async (table: "facts" | "records") => {
    const result = await db.execute(sql`SELECT count(*)::int AS count,
      md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id), '')) AS digest
      FROM ${sql.identifier(table)} t WHERE t.company_id IN
      (SELECT company_id FROM sector_companies WHERE sector_id = ${sectorId})`);
    return result[0];
  };
  const benchmarkRevisions = await db.select({ revision: sql<string>`${facts.qualifiers}->>'revision'`, count: sql<number>`count(*)::int` })
    .from(facts).where(and(eq(facts.createdBy, "benchmark_compute"), inArray(facts.companyId,
      db.select({ id: sectorCompanies.companyId }).from(sectorCompanies).where(eq(sectorCompanies.sectorId, sectorId)))))
    .groupBy(sql`${facts.qualifiers}->>'revision'`);
  return { jobs: jobs.map(job => ({ id: job.id, status: job.status, selected: job.companyIds.length,
    digest: createHash("sha256").update(JSON.stringify(job)).digest("hex") })), benchmarkRevisions,
    facts: await fingerprint("facts"), records: await fingerprint("records") };
}

/** Reclassification is atomic, code only, and never writes facts, jobs or saved benchmark revisions. */
export async function reclassifyRia(db: Db, input: { sectorId: string; path: string; dryRun?: boolean }) {
  const profile = await getProfile(db, input.sectorId);
  if (profile.playbook !== "ria" || !profile.ria) throw new DomainError("invalid_input", "requires an RIA sector");
  const [path] = await checkImportPaths([input.path], [...getImportDirs(), resolve("var/sources/sec")], SEC_MAX_FILE_BYTES);
  const buffer = await readFile(path!);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const parsed = parseSecCsv(path!.toLowerCase().endsWith(".zip") ? extractSecCsv(buffer).text : decodeSecCsv(buffer));
  if (!parsed.rows.length || parsed.skipped.length) throw new DomainError("invalid_input", "SEC file must contain valid unique CRD rows without skipped entries");
  const newest = new Map(parsed.rows.map(row => [normalizeCrd(row.crd), row]));
  if (newest.size !== parsed.rows.length) throw new DomainError("invalid_input", "duplicate CRDs in SEC file");
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ria-classification:${input.sectorId}`}))`);
    const members = await tx.select({ membership: sectorCompanies, company: companies }).from(sectorCompanies)
      .innerJoin(companies, eq(companies.id, sectorCompanies.companyId)).where(eq(sectorCompanies.sectorId, input.sectorId))
      .orderBy(sectorCompanies.companyId);
    const current = await tx.select().from(factsCurrent).where(and(ne(factsCurrent.createdBy, SNAPSHOT_COLLECTOR),
      inArray(factsCurrent.key, ["firm.regulatory_aum", "firm.wealth_share", "firm.firm_type", "firm.registration_status", "financials.employees", "firm.accounts", "firm.client_total"]),
      inArray(factsCurrent.companyId, members.map(m => m.company.id))));
    const byId = new Map<string, Map<string, typeof current[number]>>();
    for (const row of current) { const map = byId.get(row.companyId) ?? new Map(); map.set(row.key, row); byId.set(row.companyId, map); }
    const [latestImport] = await tx.select({ id: imports.id }).from(imports).where(eq(imports.sectorId, input.sectorId)).orderBy(desc(imports.createdAt)).limit(1);
    const results = members.map(({ membership, company }) => {
      const map = byId.get(company.id);
      const number = (key: string) => { const v = map?.get(key)?.valueNum; return v == null ? null : Number(v); };
      const original: RiaFacts = { aum: number("firm.regulatory_aum"), employees: number("financials.employees") ?? company.employees,
        wealthShare: number("firm.wealth_share"), firmType: map?.get("firm.firm_type")?.valueText ?? null,
        registrationStatus: map?.get("firm.registration_status")?.valueText ?? null, country: company.country, state: company.state };
      const row = newest.get(normalizeCrd(company.secCrd));
      const registration = { file: basename(path!), sha256, present: !!row,
        status: row?.registrationStatus ?? null, firmType: row?.firmType ?? null };
      const verdict = evaluateRia({ ...original, inNewestFile: registration.present,
        registrationStatus: registration.status, firmType: registration.firmType }, profile.ria!);
      const before = evaluateRia({ ...original, inNewestFile: !latestImport || membership.lastImportId === latestImport.id }, profile.ria!);
      return { membership, verdict, registration, before, staff: original.employees, accounts: number("firm.accounts"), clients: number("firm.client_total") };
    });
    const jobs = await tx.select().from(benchmarkFeeJobs).where(and(eq(benchmarkFeeJobs.sectorId, input.sectorId), eq(benchmarkFeeJobs.status, "paused")));
    const accepted = new Set(results.filter(r => r.verdict.decision === "Accept").map(r => r.membership.companyId));
    const protectedFailures = jobs.flatMap(job => job.companyIds.filter(id => !accepted.has(id)).map(companyId => ({ jobId: job.id, companyId })));
    if (protectedFailures.length) throw new DomainError("conflict", `paused fee job firms would cease to be accepted: ${JSON.stringify(protectedFailures)}`);
    const protectedBefore = await riaProtectedState(tx, input.sectorId);
    let checksRefreshed = 0;
    if (input.dryRun === false) {
      await tx.update(sectors).set({ profile: profile as unknown as Record<string, unknown> }).where(eq(sectors.id, input.sectorId));
      for (let i = 0; i < results.length; i += 250) {
        const batch = results.slice(i, i + 250);
        await tx.insert(sectorCompanies).values(batch.map(({ membership, verdict, registration }) => ({ ...membership,
          eligibility: verdict.decision === "Accept" ? "eligible" as const : verdict.decision === "Hold" ? "review" as const : "ineligible" as const,
          eligibilitySource: "rule" as const, eligibilityReason: riaStoredReason(verdict), riaDecision: verdict.decision, riaTier: verdict.tier, riaRegistration: registration })))
          .onConflictDoUpdate({ target: [sectorCompanies.sectorId, sectorCompanies.companyId], set: {
            eligibility: sql`excluded.eligibility`, eligibilitySource: sql`excluded.eligibility_source`, eligibilityReason: sql`excluded.eligibility_reason`,
            riaDecision: sql`excluded.ria_decision`, riaTier: sql`excluded.ria_tier`, riaRegistration: sql`excluded.ria_registration` } });
        await tx.insert(sectorPreflight).values(batch.map(({ membership, verdict }) => ({ id: randomUUID(), sectorId: input.sectorId,
          companyId: membership.companyId, businessType: "ria", primaryCategory: profile.scope.coreCategories[0] ?? "wealth_management",
          sellsOwnProducts: false, hasOnlineStore: false, confidence: "high" as const, reason: verdict.detail,
          verification: "verified" as const, promptVersion: "ria-tiers-v2", profileHash: profileHash(profile) })))
          .onConflictDoUpdate({ target: [sectorPreflight.sectorId, sectorPreflight.companyId], set: {
            reason: sql`excluded.reason`, promptVersion: sql`excluded.prompt_version`, profileHash: sql`excluded.profile_hash`, updatedAt: new Date() } });
      }
      await tx.execute(sql`UPDATE company_verdicts v SET status = CASE m.ria_decision
        WHEN 'Accept' THEN 'icp_accepted' WHEN 'Hold' THEN 'icp_watchlist' ELSE 'icp_rejected' END, updated_at = now(),
        exclusion_reason = CASE WHEN m.ria_decision = 'Accept' THEN NULL ELSE m.eligibility_reason END
        FROM sector_companies m WHERE m.sector_id = ${input.sectorId} AND v.sector_id = m.sector_id AND v.company_id = m.company_id`);
    }
    if (input.dryRun === false) {
      const books: TierBook[] = results.flatMap(r => r.verdict.decision !== "Accept" || r.membership.removedAt ? [] : [{
        companyId: r.membership.companyId, tier: r.verdict.tier!,
        accountsPer: r.staff && r.accounts !== null ? r.accounts / r.staff : null,
        clientsPer: r.staff && r.clients !== null ? r.clients / r.staff : null,
      }]);
      checksRefreshed = await refreshTierHeavyBooks(tx, input.sectorId, books, results.map(r => ({ companyId: r.membership.companyId, decision: r.verdict.decision, reason: riaStoredReason(r.verdict) })));
      clearHeavyBookCache(input.sectorId);
    }
    const byDecision = { Accept: 0, Hold: 0, Reject: 0 };
    const byTier = { "0": 0, "1": 0, "2": 0 };
    const byReason: Record<string, number> = {};
    for (const { verdict } of results) {
      byDecision[verdict.decision]++;
      if (verdict.tier !== null) byTier[verdict.tier]++;
      const reason = riaStoredReason(verdict); byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
    const protectedAfter = await riaProtectedState(tx, input.sectorId);
    if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) throw new DomainError("conflict", "protected benchmark or job state changed");
    return { sectorId: input.sectorId, dryRun: input.dryRun !== false, file: basename(path!), sha256,
      total: results.length, byDecision, byTier, byReason, checksRefreshed, protectedState: protectedAfter,
      registrationChanges: results.filter(r => riaStoredReason(r.before) !== riaStoredReason(r.verdict)).map(r => ({
        companyId: r.membership.companyId, before: riaStoredReason(r.before), decision: r.verdict.decision,
        tier: r.verdict.tier, reason: riaStoredReason(r.verdict), detail: r.verdict.detail })) };
  });
}
