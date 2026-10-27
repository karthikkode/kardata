import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  companies,
  sectorCompanies,
  sectorEligibilityOverrides,
  sectorPreflight,
  sectors,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";
import {
  SKINCARE_PROFILE,
  getProfileOrNull,
  resolveProfileForSector,
  validateRubricAgainstProfile,
  type SectorProfile,
} from "./profile.js";

/**
 * Eligibility = rules over the classification (Stage 5.1 Step 2). No LLM:
 * derived from the sector rubric plus the classification, re-derivable
 * instantly, with owner overrides winning always.
 */

export const eligibilityRubricSchema = z
  .object({
    eligible: z
      .object({
        businessTypes: z.array(z.string().min(1)).max(30),
        primaryCategories: z.array(z.string().min(1)).max(30),
        requireSellsOwnProducts: z.boolean(),
        requireHasOnlineStore: z.boolean(),
      })
      .strict(),
    review: z
      .object({
        businessTypes: z.array(z.string().min(1)).max(30),
        primaryCategories: z.array(z.string().min(1)).max(30),
        lowConfidence: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type EligibilityRubric = z.infer<typeof eligibilityRubricSchema>;

export const DEFAULT_SKINCARE_RUBRIC: EligibilityRubric = {
  eligible: {
    businessTypes: ["dtc_brand"],
    primaryCategories: ["skincare", "body_bath", "mens_grooming"],
    requireSellsOwnProducts: true,
    requireHasOnlineStore: true,
  },
  review: {
    businessTypes: ["brand_retail_only", "unknown"],
    primaryCategories: ["haircare", "cosmetics_makeup", "fragrance", "supplements_wellness"],
    lowConfidence: true,
  },
};

export interface ClassifiedFields {
  businessType: string;
  primaryCategory: string;
  sellsOwnProducts: boolean;
  hasOnlineStore: boolean;
  confidence: string;
}

export type DerivedEligibility = "eligible" | "review" | "ineligible";

/**
 * Could this classification still be in scope? Its type is one the rubric
 * accepts or reviews, and its category is one the rubric accepts or reviews
 * ("other" counts only when the type is unknown too).
 */
function isPossibleQualifier(c: ClassifiedFields, rubric: EligibilityRubric): boolean {
  const types = [...rubric.eligible.businessTypes, ...rubric.review.businessTypes];
  if (!types.includes(c.businessType)) return false;
  return inRelevantCategory(c, rubric);
}

/** A category the rubric accepts or reviews ("other" only with an unknown type). */
function inRelevantCategory(c: ClassifiedFields, rubric: EligibilityRubric): boolean {
  const categories = [...rubric.eligible.primaryCategories, ...rubric.review.primaryCategories];
  return categories.includes(c.primaryCategory) || (c.primaryCategory === "other" && c.businessType === "unknown");
}

/** Pure rule evaluation over one classification. */
export function evaluateClassification(
  c: ClassifiedFields,
  rubric: EligibilityRubric,
): { eligibility: DerivedEligibility; reason: string } {
  const e = rubric.eligible;
  const r = rubric.review;
  // Uncertainty jumps the queue, but only for a possible qualifier: a
  // low-confidence classification (always the case for Apollo-only input)
  // needs review when its type and category could still be in scope, even if
  // they match the eligible rule. A clear non-qualifier (a retailer, an
  // off-category brand) falls through to the normal rules.
  if (r.lowConfidence && c.confidence === "low" && isPossibleQualifier(c, rubric)) {
    return {
      eligibility: "review",
      reason: `needs review: low confidence, possible ${c.businessType}/${c.primaryCategory}`,
    };
  }
  if (
    e.businessTypes.includes(c.businessType) &&
    e.primaryCategories.includes(c.primaryCategory) &&
    (!e.requireSellsOwnProducts || c.sellsOwnProducts) &&
    (!e.requireHasOnlineStore || c.hasOnlineStore)
  ) {
    return { eligibility: "eligible", reason: `matches eligible rule: ${c.businessType} + ${c.primaryCategory}` };
  }
  const triggers: string[] = [];
  // A review type (retail-only brand, unknown) only matters in a relevant
  // category: a retail-only indoor-furniture brand is out, not a review.
  if (r.businessTypes.includes(c.businessType) && inRelevantCategory(c, rubric)) {
    triggers.push(`business_type ${c.businessType}`);
  }
  if (r.primaryCategories.includes(c.primaryCategory)) triggers.push(`category ${c.primaryCategory}`);
  if (triggers.length > 0) {
    return { eligibility: "review", reason: `needs review: ${triggers.join(", ")}` };
  }
  return { eligibility: "ineligible", reason: `matches no eligible or review rule (${c.businessType}/${c.primaryCategory})` };
}

export interface DerivedTriple {
  eligibility: "pending" | DerivedEligibility;
  source: "rule" | "override" | null;
  reason: string | null;
}

// Owner scope decision: in-sector = D2C, selling its own products through
// its own store, and the products are skincare-related. Hair, makeup,
// fragrance and supplements count only when skin-related; everything else
// (including low-confidence rows without skin evidence) is out.
export const SCOPE_CORE_CATEGORIES = ["skincare", "body_bath", "mens_grooming"];
export const SCOPE_ADJACENT_CATEGORIES = ["haircare", "cosmetics_makeup", "fragrance", "supplements_wellness"];

export const SKIN_KEYWORDS = [
  "skin",
  "derma",
  "dermat",
  "collagen",
  "elastin",
  "retinol",
  "retinoid",
  "tretinoin",
  "hyaluron",
  "niacinamide",
  "peptid",
  "ceramid",
  "moisturiz",
  "moisturis",
  "serum",
  "acne",
  "eczema",
  "psoriasis",
  "rosacea",
  "sunscreen",
  "sun screen",
  "suncare",
  "sun care",
  "spf",
  "exfoliat",
  "cleanser",
  "facial",
  "face wash",
  "facewash",
  "toner",
  "lotion",
  "night cream",
  "day cream",
  "eye cream",
  "vitamin c",
  "glycolic",
  "salicylic",
  "azelaic",
  "kojic",
  "anti-ag",
  "antiag",
  "wrinkle",
  "dark spot",
  "hyperpigment",
  "melasma",
  "skin barrier",
];

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

function firstHit(haystack: string, keywords: string[] = SKIN_KEYWORDS): string | null {
  const lower = haystack.toLowerCase();
  for (const keyword of keywords) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

/** First scope keyword hit in classifier-read evidence (reason, quote, name). */
export function siteKeywordHit(
  input: Pick<ScopeInput, "reason" | "quote" | "companyName">,
  keywords?: string[],
): string | null {
  return firstHit([input.reason, input.quote ?? "", input.companyName].join("\n"), keywords);
}

/** First scope keyword hit in Apollo keywords (noisy 40-keyword soup). */
export function apolloKeywordHit(input: Pick<ScopeInput, "apolloKeywords">, keywords?: string[]): string | null {
  return firstHit(input.apolloKeywords.join(" "), keywords);
}

/**
 * Binary sector-scope verdict over one classification. Evidence hierarchy:
 * site-read evidence always counts; Apollo keywords count only when the
 * site was unreadable (low confidence), exactly the blocked-site case they
 * exist for. A readable site selling skincare would show it.
 */
export function evaluateSectorScope(
  input: ScopeInput,
  profile: SectorProfile = SKINCARE_PROFILE,
): { eligible: boolean; reason: string } {
  const keywords = profile.scope.scopeKeywords;
  if (input.businessType !== "dtc_brand") {
    return { eligible: false, reason: `sector scope: not D2C (${input.businessType})` };
  }
  if (!input.sellsOwnProducts) return { eligible: false, reason: "sector scope: no own products" };
  if (!input.hasOnlineStore) return { eligible: false, reason: "sector scope: no online store" };
  if (profile.scope.coreCategories.includes(input.primaryCategory)) {
    return { eligible: true, reason: `sector scope: D2C ${input.primaryCategory}` };
  }
  if (profile.scope.adjacentCategories.includes(input.primaryCategory)) {
    const siteHit = siteKeywordHit(input, keywords);
    if (siteHit) {
      return { eligible: true, reason: `sector scope: D2C ${input.primaryCategory}, skin-related (${siteHit})` };
    }
    if (input.confidence === "low") {
      const apolloHit = apolloKeywordHit(input, keywords);
      if (apolloHit) {
        return {
          eligible: true,
          reason: `sector scope: D2C ${input.primaryCategory}, skin-related (${apolloHit}, apollo-attested)`,
        };
      }
    }
    return { eligible: false, reason: `sector scope: ${input.primaryCategory} out of scope, not skin-related` };
  }
  return { eligible: false, reason: `sector scope: ${input.primaryCategory} out of scope` };
}

export function deriveForCompany(input: {
  classification: ClassifiedFields | null;
  override: { decision: "include" | "exclude"; note: string } | null;
  rubric: EligibilityRubric;
}): DerivedTriple {
  if (input.override?.decision === "include") {
    return { eligibility: "eligible", source: "override", reason: input.override.note || "owner include" };
  }
  if (input.override?.decision === "exclude") {
    return { eligibility: "ineligible", source: "override", reason: input.override.note || "owner exclude" };
  }
  if (!input.classification) return { eligibility: "pending", source: null, reason: null };
  const { eligibility, reason } = evaluateClassification(input.classification, input.rubric);
  return { eligibility, source: "rule", reason };
}

async function loadSector(db: Db, sectorId: string): Promise<void> {
  const [sector] = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, sectorId));
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
}

/**
 * Stored rubric. Only the legacy sector named "skincare" may fall back to
 * the skincare default (matching the profile fallback); any other sector
 * without a stored rubric is refused in plain words.
 */
export async function getRubric(db: Db, sectorId: string): Promise<{ rubric: EligibilityRubric; isDefault: boolean }> {
  const [row] = await db
    .select({ rules: sectors.eligibilityRules, name: sectors.name })
    .from(sectors)
    .where(eq(sectors.id, sectorId));
  if (!row) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  if (!row.rules) {
    if (row.name.trim().toLowerCase() === "skincare") {
      return { rubric: DEFAULT_SKINCARE_RUBRIC, isDefault: true };
    }
    throw new DomainError(
      "invalid_input",
      `sector "${row.name}" has no eligibility rubric; set one with sector_rules_set`,
    );
  }
  const parsed = eligibilityRubricSchema.safeParse(row.rules);
  if (!parsed.success) throw new DomainError("invalid_input", "stored rubric is invalid; set it again");
  return { rubric: parsed.data, isDefault: false };
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

/** Re-derive one membership row from its classification + override. */
export async function deriveCompany(db: Db, sectorId: string, companyId: string): Promise<DerivedTriple> {
  const [membership] = await db
    .select()
    .from(sectorCompanies)
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));
  if (!membership) throw new DomainError("not_found", "company is not in this sector");
  const { rubric } = await getRubric(db, sectorId);
  const [classification] = await db
    .select()
    .from(sectorPreflight)
    .where(and(eq(sectorPreflight.sectorId, sectorId), eq(sectorPreflight.companyId, companyId)));
  const [override] = await db
    .select()
    .from(sectorEligibilityOverrides)
    .where(
      and(eq(sectorEligibilityOverrides.sectorId, sectorId), eq(sectorEligibilityOverrides.companyId, companyId)),
    );
  const triple = deriveForCompany({
    classification: classification
      ? {
          businessType: classification.businessType,
          primaryCategory: classification.primaryCategory,
          sellsOwnProducts: classification.sellsOwnProducts,
          hasOnlineStore: classification.hasOnlineStore,
          confidence: classification.confidence,
        }
      : null,
    override: override ? { decision: override.decision, note: override.note } : null,
    rubric,
  });
  await db
    .update(sectorCompanies)
    .set({ eligibility: triple.eligibility, eligibilitySource: triple.source, eligibilityReason: triple.reason })
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, companyId)));
  return triple;
}

/** Re-derive every membership row of a sector (rubric edits). Returns fresh counts. */
export async function rederiveSector(db: Db, sectorId: string): Promise<EligibilityCounts> {
  await loadSector(db, sectorId);
  await getRubric(db, sectorId);
  const members = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(eq(sectorCompanies.sectorId, sectorId));
  for (const member of members) {
    await deriveCompany(db, sectorId, member.companyId);
  }
  return eligibilityCounts(db, sectorId);
}

export interface ScopeApplyResult {
  eligible: number;
  ineligible: number;
  skippedOverride: number;
  skippedPending: number;
}

/**
 * Resolve every classified, non-overridden membership to the binary sector
 * scope (owner decision). Overrides always win; pending rows stay pending.
 */
export async function applySectorScope(db: Db, sectorId: string): Promise<ScopeApplyResult> {
  await loadSector(db, sectorId);
  const profile = await resolveProfileForSector(db, sectorId);
  const rows = await db
    .select({
      companyId: sectorCompanies.companyId,
      businessType: sectorPreflight.businessType,
      primaryCategory: sectorPreflight.primaryCategory,
      sellsOwnProducts: sectorPreflight.sellsOwnProducts,
      hasOnlineStore: sectorPreflight.hasOnlineStore,
      confidence: sectorPreflight.confidence,
      reason: sectorPreflight.reason,
      quote: sectorPreflight.quote,
      name: companies.name,
      keywords: companies.keywords,
      override: sectorEligibilityOverrides.decision,
    })
    .from(sectorCompanies)
    .innerJoin(companies, eq(companies.id, sectorCompanies.companyId))
    .leftJoin(
      sectorPreflight,
      and(eq(sectorPreflight.sectorId, sectorCompanies.sectorId), eq(sectorPreflight.companyId, sectorCompanies.companyId)),
    )
    .leftJoin(
      sectorEligibilityOverrides,
      and(
        eq(sectorEligibilityOverrides.sectorId, sectorCompanies.sectorId),
        eq(sectorEligibilityOverrides.companyId, sectorCompanies.companyId),
      ),
    )
    .where(eq(sectorCompanies.sectorId, sectorId));
  const result: ScopeApplyResult = { eligible: 0, ineligible: 0, skippedOverride: 0, skippedPending: 0 };
  for (const row of rows) {
    if (row.override) {
      result.skippedOverride += 1;
      continue;
    }
    if (!row.businessType || !row.primaryCategory || !row.reason) {
      result.skippedPending += 1;
      continue;
    }
    const verdict = evaluateSectorScope(
      {
        businessType: row.businessType,
      primaryCategory: row.primaryCategory,
      sellsOwnProducts: row.sellsOwnProducts ?? false,
      hasOnlineStore: row.hasOnlineStore ?? false,
      confidence: row.confidence ?? "",
      reason: row.reason,
      quote: row.quote,
        companyName: row.name ?? "",
        apolloKeywords: row.keywords ?? [],
      },
      profile,
    );
    await db
      .update(sectorCompanies)
      .set({
        eligibility: verdict.eligible ? "eligible" : "ineligible",
        eligibilitySource: "rule",
        eligibilityReason: verdict.reason,
      })
      .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.companyId, row.companyId)));
    if (verdict.eligible) result.eligible += 1;
    else result.ineligible += 1;
  }
  return result;
}

/** The one validated rubric path: schema, then profile category check. */
export function parseEligibilityRubric(rules: unknown, profile?: SectorProfile | null): EligibilityRubric {
  const parsed = eligibilityRubricSchema.safeParse(rules);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    throw new DomainError("invalid_input", `invalid rubric: ${where}${first?.message ?? "rejected"}`);
  }
  if (profile) validateRubricAgainstProfile(parsed.data, profile);
  return parsed.data;
}

/** Validate, store, and re-derive; returns before→after counts. */
export async function setRubric(
  db: Db,
  sectorId: string,
  rules: unknown,
): Promise<{ rubric: EligibilityRubric; before: EligibilityCounts; after: EligibilityCounts }> {
  await loadSector(db, sectorId);
  const profile = await getProfileOrNull(db, sectorId);
  const rubric = parseEligibilityRubric(rules, profile);
  const before = await eligibilityCounts(db, sectorId);
  await db
    .update(sectors)
    .set({ eligibilityRules: rubric as Record<string, unknown> })
    .where(eq(sectors.id, sectorId));
  const after = await rederiveSector(db, sectorId);
  return { rubric, before, after };
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
