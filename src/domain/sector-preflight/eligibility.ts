import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import {
  sectorCompanies,
  sectorEligibilityOverrides,
  sectorPreflight,
  sectors,
} from "../../db/schema.js";
import { DomainError } from "../errors.js";

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

/** Pure rule evaluation over one classification. */
export function evaluateClassification(
  c: ClassifiedFields,
  rubric: EligibilityRubric,
): { eligibility: DerivedEligibility; reason: string } {
  const e = rubric.eligible;
  const r = rubric.review;
  // Uncertainty jumps the queue: a low-confidence classification (always the
  // case for Apollo-only input) needs review even when its types match the
  // eligible rule.
  if (r.lowConfidence && c.confidence === "low") {
    return { eligibility: "review", reason: "needs review: low confidence" };
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
  if (r.businessTypes.includes(c.businessType)) triggers.push(`business_type ${c.businessType}`);
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

/** Stored rubric, or the skincare default when the sector has none. */
export async function getRubric(db: Db, sectorId: string): Promise<{ rubric: EligibilityRubric; isDefault: boolean }> {
  await loadSector(db, sectorId);
  const [row] = await db.select({ rules: sectors.eligibilityRules }).from(sectors).where(eq(sectors.id, sectorId));
  if (!row?.rules) return { rubric: DEFAULT_SKINCARE_RUBRIC, isDefault: true };
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
  const members = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(eq(sectorCompanies.sectorId, sectorId));
  for (const member of members) {
    await deriveCompany(db, sectorId, member.companyId);
  }
  return eligibilityCounts(db, sectorId);
}

/** Validate, store, and re-derive; returns before→after counts. */
export async function setRubric(
  db: Db,
  sectorId: string,
  rules: unknown,
): Promise<{ rubric: EligibilityRubric; before: EligibilityCounts; after: EligibilityCounts }> {
  await loadSector(db, sectorId);
  const parsed = eligibilityRubricSchema.safeParse(rules);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    throw new DomainError("invalid_input", `invalid rubric: ${where}${first?.message ?? "rejected"}`);
  }
  const before = await eligibilityCounts(db, sectorId);
  await db
    .update(sectors)
    .set({ eligibilityRules: parsed.data as Record<string, unknown> })
    .where(eq(sectors.id, sectorId));
  const after = await rederiveSector(db, sectorId);
  return { rubric: parsed.data, before, after };
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
