import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  companies,
  factsCurrent,
  sectorCompanies,
  sectorEligibilityOverrides,
  sectorPreflight,
  sectors,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { getProfile, profileHash, type SectorProfile } from "./profile.js";
import { evaluateRia, riaStoredReason, type RiaFacts } from "./ria.js";

/**
 * Eligibility = the sector scope over the classification. No LLM: derived
 * from the stored profile plus the classification, re-derivable instantly,
 * with owner overrides winning always. One path only (Stage 5.6 B2).
 */

export interface ScopeInput {
  businessType: string;
  primaryCategory: string;
  sellsOwnProducts: boolean;
  hasOnlineStore: boolean;
  confidence: string;
  reason: string;
  quote: string | null;
  companyName: string;
  apolloKeywords: string[];
}

function firstHit(haystack: string, keywords: string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const keyword of keywords) {
    if (lower.includes(keyword.toLowerCase())) return keyword;
  }
  return null;
}

/** First scope keyword hit in classifier-read evidence (reason, quote, name). */
export function siteKeywordHit(
  input: Pick<ScopeInput, "reason" | "quote" | "companyName">,
  keywords: string[],
): string | null {
  return firstHit([input.reason, input.quote ?? "", input.companyName].join("\n"), keywords);
}

/** First scope keyword hit in Apollo keywords (noisy keyword soup). */
export function apolloKeywordHit(input: Pick<ScopeInput, "apolloKeywords">, keywords: string[]): string | null {
  return firstHit(input.apolloKeywords.join(" "), keywords);
}

/**
 * Binary sector-scope verdict over one classification. Evidence hierarchy:
 * site-read evidence always counts; Apollo keywords count only when the
 * site was unreadable (low confidence), exactly the blocked-site case they
 * exist for. A readable site selling in-scope products would show it.
 */
export function evaluateSectorScope(
  input: ScopeInput,
  profile: SectorProfile,
): { eligible: boolean; reason: string } {
  const scope = profile.scope;
  const keywords = scope.scopeKeywords;
  if (!scope.businessTypes.includes(input.businessType)) {
    return { eligible: false, reason: `sector scope: business type ${input.businessType} out of scope` };
  }
  if (scope.requireSellsOwnProducts && !input.sellsOwnProducts) {
    return { eligible: false, reason: "sector scope: no own products" };
  }
  if (scope.requireHasOnlineStore && !input.hasOnlineStore) {
    return { eligible: false, reason: "sector scope: no online store" };
  }
  if (scope.coreCategories.includes(input.primaryCategory)) {
    return { eligible: true, reason: `sector scope: ${input.primaryCategory}` };
  }
  if (scope.adjacentCategories.includes(input.primaryCategory)) {
    const siteHit = siteKeywordHit(input, keywords);
    if (siteHit) {
      return { eligible: true, reason: `sector scope: ${input.primaryCategory}, keyword hit (${siteHit})` };
    }
    if (input.confidence === "low") {
      const apolloHit = apolloKeywordHit(input, keywords);
      if (apolloHit) {
        return {
          eligible: true,
          reason: `sector scope: ${input.primaryCategory}, keyword hit (${apolloHit}, apollo-attested)`,
        };
      }
    }
    return { eligible: false, reason: `sector scope: ${input.primaryCategory} out of scope, no keyword hit` };
  }
  return { eligible: false, reason: `sector scope: ${input.primaryCategory} out of scope` };
}

export interface DerivedTriple {
  eligibility: "pending" | "eligible" | "ineligible";
  source: "rule" | "override" | null;
  reason: string | null;
}

export type EligibilityCounts = Record<"pending" | "eligible" | "review" | "ineligible", number>;

export async function eligibilityCounts(db: Db, sectorId: string): Promise<EligibilityCounts> {
  const rows = await db
    .select({ eligibility: sectorCompanies.eligibility, n: sql<number>`count(*)` })
    .from(sectorCompanies)
    .where(eq(sectorCompanies.sectorId, sectorId))
    .groupBy(sectorCompanies.eligibility);
  const counts: EligibilityCounts = { pending: 0, eligible: 0, review: 0, ineligible: 0 };
  for (const row of rows) counts[row.eligibility] = Number(row.n);
  return counts;
}

async function loadSector(db: Db, sectorId: string): Promise<void> {
  const [sector] = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, sectorId));
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
}

/** Re-derive one membership row: override first, then the sector scope. */
export async function deriveCompany(db: Db, sectorId: string, companyId: string): Promise<DerivedTriple> {
  const [membership] = await db
    .select()
    .from(sectorCompanies)
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));
  if (!membership) throw new DomainError("not_found", "company is not in this sector");
  const [override] = await db
    .select()
    .from(sectorEligibilityOverrides)
    .where(
      and(eq(sectorEligibilityOverrides.sectorId, sectorId), eq(sectorEligibilityOverrides.companyId, companyId)),
    );
  if (override?.decision === "include") {
    const triple: DerivedTriple = { eligibility: "eligible", source: "override", reason: override.note || "owner include" };
    await storeTriple(db, sectorId, companyId, triple);
    return triple;
  }
  if (override?.decision === "exclude") {
    const triple: DerivedTriple = { eligibility: "ineligible", source: "override", reason: override.note || "owner exclude" };
    await storeTriple(db, sectorId, companyId, triple);
    return triple;
  }
  const profileForPlaybook = await getProfile(db, sectorId);
  if (profileForPlaybook.playbook === "ria") {
    return deriveRiaCompany(db, sectorId, companyId, profileForPlaybook);
  }
  const [classification] = await db
    .select()
    .from(sectorPreflight)
    .where(and(eq(sectorPreflight.sectorId, sectorId), eq(sectorPreflight.companyId, companyId)));
  if (!classification) {
    const triple: DerivedTriple = { eligibility: "pending", source: null, reason: null };
    await storeTriple(db, sectorId, companyId, triple);
    return triple;
  }
  const profile = await getProfile(db, sectorId);
  const [company] = await db
    .select({ name: companies.name, keywords: companies.keywords })
    .from(companies)
    .where(eq(companies.id, companyId));
  const verdict = evaluateSectorScope(
    {
      businessType: classification.businessType,
      primaryCategory: classification.primaryCategory,
      sellsOwnProducts: classification.sellsOwnProducts,
      hasOnlineStore: classification.hasOnlineStore,
      confidence: classification.confidence,
      reason: classification.reason,
      quote: classification.quote,
      companyName: company?.name ?? "",
      apolloKeywords: company?.keywords ?? [],
    },
    profile,
  );
  const triple: DerivedTriple = {
    eligibility: verdict.eligible ? "eligible" : "ineligible",
    source: "rule",
    reason: verdict.reason,
  };
  await storeTriple(db, sectorId, companyId, triple);
  return triple;
}

const RIA_FACT_KEYS = [
  "firm.regulatory_aum",
  "firm.wealth_share",
  "firm.firm_type",
  "firm.registration_status",
  "financials.employees",
] as const;

export async function loadRiaFacts(db: Db, companyId: string): Promise<{ facts: RiaFacts; hasFacts: boolean }> {
  const [company] = await db
    .select({ country: companies.country, state: companies.state, employees: companies.employees })
    .from(companies)
    .where(eq(companies.id, companyId));
  const rows = await db
    .select()
    .from(factsCurrent)
    .where(and(eq(factsCurrent.companyId, companyId), inArray(factsCurrent.key, [...RIA_FACT_KEYS])));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const num = (key: string): number | null => {
    const row = byKey.get(key);
    if (!row || row.valueNum === null || row.valueNum === undefined) return null;
    const n = Number(row.valueNum);
    return Number.isFinite(n) ? n : null;
  };
  const text = (key: string): string | null => {
    const row = byKey.get(key);
    return row && typeof row.valueText === "string" && row.valueText !== "" ? row.valueText : null;
  };
  const staffFact = num("financials.employees");
  return {
    hasFacts: rows.length > 0,
    facts: {
      aum: num("firm.regulatory_aum"),
      employees: staffFact !== null ? Math.round(staffFact) : (company?.employees ?? null),
      wealthShare: num("firm.wealth_share"),
      firmType: text("firm.firm_type"),
      registrationStatus: text("firm.registration_status"),
      country: company?.country ?? null,
      state: company?.state ?? null,
    },
  };
}

/** RIA derive: rules over the imported facts; also files the preflight row the summary reads. */
export async function deriveRiaCompany(
  db: Db,
  sectorId: string,
  companyId: string,
  profile: SectorProfile,
): Promise<DerivedTriple> {
  const thresholds = profile.ria;
  if (!thresholds) throw new DomainError("invalid_input", "ria sector has no ria thresholds");
  const { facts, hasFacts } = await loadRiaFacts(db, companyId);
  if (!hasFacts) {
    const triple: DerivedTriple = { eligibility: "pending", source: null, reason: null };
    await storeTriple(db, sectorId, companyId, triple);
    return triple;
  }
  const verdict = evaluateRia(facts, thresholds);
  const category = profile.scope.coreCategories[0] ?? "wealth_management";
  await db
    .insert(sectorPreflight)
    .values({
      id: randomUUID(),
      sectorId,
      companyId,
      runId: null,
      businessType: "ria",
      primaryCategory: category,
      sellsOwnProducts: false,
      hasOnlineStore: false,
      shipsTo: [],
      confidence: "high",
      reason: verdict.detail,
      quote: null,
      quoteSourceId: null,
      verification: "verified",
      promptVersion: "ria-rules-v1",
      profileHash: profileHash(profile),
    })
    .onConflictDoUpdate({
      target: [sectorPreflight.sectorId, sectorPreflight.companyId],
      set: {
        businessType: "ria",
        primaryCategory: category,
        sellsOwnProducts: false,
        hasOnlineStore: false,
        shipsTo: [],
        confidence: "high",
        reason: verdict.detail,
        quote: null,
        quoteSourceId: null,
        verification: "verified",
        promptVersion: "ria-rules-v1",
        profileHash: profileHash(profile),
        updatedAt: new Date(),
      },
    });
  const triple: DerivedTriple = {
    eligibility: verdict.eligible ? "eligible" : "ineligible",
    source: "rule",
    reason: riaStoredReason(verdict),
  };
  await storeTriple(db, sectorId, companyId, triple);
  return triple;
}

async function storeTriple(db: Db, sectorId: string, companyId: string, triple: DerivedTriple): Promise<void> {
  await db
    .update(sectorCompanies)
    .set({ eligibility: triple.eligibility, eligibilitySource: triple.source, eligibilityReason: triple.reason })
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));
}

export interface ScopeApplyResult {
  eligible: number;
  ineligible: number;
  skippedOverride: number;
  skippedPending: number;
}

/**
 * Re-apply the stored profile's scope to every membership of a sector.
 * Overrides always win; unclassified rows stay pending.
 */
export async function rederiveSectorScope(db: Db, sectorId: string): Promise<ScopeApplyResult> {
  await loadSector(db, sectorId);
  await getProfile(db, sectorId);
  const members = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(eq(sectorCompanies.sectorId, sectorId));
  const result: ScopeApplyResult = { eligible: 0, ineligible: 0, skippedOverride: 0, skippedPending: 0 };
  for (const member of members) {
    const triple = await deriveCompany(db, sectorId, member.companyId);
    if (triple.source === "override") result.skippedOverride += 1;
    else if (triple.eligibility === "pending") result.skippedPending += 1;
    else if (triple.eligibility === "eligible") result.eligible += 1;
    else result.ineligible += 1;
  }
  return result;
}

export type OverrideDecision = "include" | "exclude" | "clear";

/** Set or clear an override, then re-derive that company. */
export async function setOverride(
  db: Db,
  sectorId: string,
  companyId: string,
  decision: OverrideDecision,
  note = "",
): Promise<DerivedTriple> {
  const [membership] = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));
  if (!membership) throw new DomainError("not_found", "company is not in this sector");
  if (decision === "clear") {
    await db
      .delete(sectorEligibilityOverrides)
      .where(and(eq(sectorEligibilityOverrides.sectorId, sectorId), eq(sectorEligibilityOverrides.companyId, companyId)));
  } else {
    await db
      .insert(sectorEligibilityOverrides)
      .values({ sectorId, companyId, decision, note: note.slice(0, 2000) })
      .onConflictDoUpdate({
        target: [sectorEligibilityOverrides.sectorId, sectorEligibilityOverrides.companyId],
        set: { decision, note: note.slice(0, 2000), updatedAt: new Date() },
      });
  }
  return deriveCompany(db, sectorId, companyId);
}
