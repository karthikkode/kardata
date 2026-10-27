import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { sectorCompanies, sectorPreflight, sectors } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { BUSINESS_TYPES, PRIMARY_CATEGORIES } from "./classify.js";
import {
  eligibilityCounts,
  type EligibilityCounts,
  type EligibilityRubric,
} from "./eligibility.js";

/**
 * Sector profile (Stage 5.4 Step 1): everything sector-specific about the
 * preflight, stored per sector as jsonb on the sector row. Storage choice:
 * jsonb on `sectors`, like the eligibility rubric — the profile is always
 * read and written whole, never queried by category, and it versions with
 * the sector. A sector with no profile cannot be preflighted.
 */

const categoryKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "category key must be snake_case");

export const sectorProfileSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    rubric: z.unknown().optional(),
    categories: z
      .array(
        z
          .object({
            key: categoryKey,
            label: z.string().min(1).max(120),
            description: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    scope: z
      .object({
        coreCategories: z.array(categoryKey).max(20),
        adjacentCategories: z.array(categoryKey).max(20),
        scopeKeywords: z.array(z.string().min(1).max(120)).max(200),
      })
      .strict(),
    classifierHints: z
      .object({
        serviceExamples: z.string().max(500),
        retailerExamples: z.string().max(500),
        supplierExamples: z.string().max(500),
      })
      .strict(),
  })
  .strict();

export type SectorProfile = z.infer<typeof sectorProfileSchema>;

export const OTHER_CATEGORY = {
  key: "other",
  label: "Other",
  description: "A real business whose main lane is none of the listed categories.",
} as const;

/** Validate and normalize a profile: `other` is always present. */
export function parseSectorProfile(value: unknown): SectorProfile {
  const parsed = sectorProfileSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    throw new DomainError("invalid_input", `invalid sector profile: ${where}${first?.message ?? "rejected"}`);
  }
  const profile = parsed.data;
  const keys = profile.categories.map((c) => c.key);
  if (new Set(keys).size !== keys.length) {
    throw new DomainError("invalid_input", "invalid sector profile: duplicate category keys");
  }
  if (!keys.includes("other")) {
    if (profile.categories.length >= 20) {
      throw new DomainError("invalid_input", "invalid sector profile: at most 20 categories including other");
    }
    profile.categories = [...profile.categories, { ...OTHER_CATEGORY }];
  }
  if (profile.categories.length < 2) {
    throw new DomainError("invalid_input", "invalid sector profile: at least 2 categories are required");
  }
  const known = new Set(profile.categories.map((c) => c.key));
  for (const key of [...profile.scope.coreCategories, ...profile.scope.adjacentCategories]) {
    if (!known.has(key)) {
      throw new DomainError("invalid_input", `invalid sector profile: scope lists unknown category "${key}"`);
    }
  }
  const overlap = profile.scope.coreCategories.filter((k) => profile.scope.adjacentCategories.includes(k));
  if (overlap.length > 0) {
    throw new DomainError(
      "invalid_input",
      `invalid sector profile: categories in both core and adjacent scope: ${overlap.join(", ")}`,
    );
  }
  return profile;
}

export function categoryKeys(profile: SectorProfile): string[] {
  return profile.categories.map((c) => c.key);
}

/** Stable hash of the category keys a classification was made with. */
export function profileHash(profile: SectorProfile): string {
  return createHash("sha256").update(categoryKeys(profile).join(",")).digest("hex").slice(0, 16);
}

/** Rubric categories and business types must exist in the profile / enum. */
export function validateRubricAgainstProfile(rubric: EligibilityRubric, profile: SectorProfile): void {
  const known = new Set(categoryKeys(profile));
  for (const key of [...rubric.eligible.primaryCategories, ...rubric.review.primaryCategories]) {
    if (!known.has(key)) {
      throw new DomainError("invalid_input", `rubric lists unknown category "${key}" for this sector's profile`);
    }
  }
  for (const type of [...rubric.eligible.businessTypes, ...rubric.review.businessTypes]) {
    if (!(BUSINESS_TYPES as readonly string[]).includes(type)) {
      throw new DomainError("invalid_input", `rubric lists unknown business_type "${type}"`);
    }
  }
}

/** The skincare profile: today's constants, field for field. */
export const SKINCARE_PROFILE: SectorProfile = {
  categories: [
    { key: "skincare", label: "Skincare", description: "Skin care products: cleansers, serums, moisturisers, SPF, treatments." },
    { key: "haircare", label: "Haircare", description: "Hair care products: shampoo, conditioner, styling, treatments." },
    { key: "cosmetics_makeup", label: "Cosmetics & makeup", description: "Colour cosmetics and makeup." },
    { key: "body_bath", label: "Body & bath", description: "Body care, bath, hand and foot care." },
    { key: "fragrance", label: "Fragrance", description: "Perfume, fragrance, home scent." },
    { key: "supplements_wellness", label: "Supplements & wellness", description: "Supplements and wellness products and devices." },
    { key: "mens_grooming", label: "Men's grooming", description: "Men's grooming and shaving products." },
    { key: "other", label: "Other", description: OTHER_CATEGORY.description },
  ],
  scope: {
    coreCategories: ["skincare", "body_bath", "mens_grooming"],
    adjacentCategories: ["haircare", "cosmetics_makeup", "fragrance", "supplements_wellness"],
    scopeKeywords: [
      "skin", "derma", "dermat", "collagen", "elastin", "retinol", "retinoid", "tretinoin",
      "hyaluron", "niacinamide", "peptid", "ceramid", "moisturiz", "moisturis", "serum",
      "acne", "eczema", "psoriasis", "rosacea", "sunscreen", "sun screen", "suncare",
      "sun care", "spf", "exfoliat", "cleanser", "facial", "face wash", "facewash",
      "toner", "lotion", "night cream", "day cream", "eye cream", "vitamin c", "glycolic",
      "salicylic", "azelaic", "kojic", "anti-ag", "antiag", "wrinkle", "dark spot",
      "hyperpigment", "melasma", "skin barrier",
    ],
  },
  classifierHints: {
    serviceExamples: "spa, salon, barbershop, beauty services without own product line",
    retailerExamples: "beauty store, pharmacy chain, marketplace selling other brands",
    supplierExamples: "raw ingredients, packaging, or equipment supplier",
  },
};

async function loadSectorRow(db: Db, sectorId: string) {
  const [sector] = await db.select().from(sectors).where(eq(sectors.id, sectorId));
  if (!sector) throw new DomainError("not_found", `sector not found: ${sectorId}`);
  return sector;
}

/** Stored profile, or a plain refusal: no profile means no preflight. */
export async function getProfile(db: Db, sectorId: string): Promise<SectorProfile> {
  const sector = await loadSectorRow(db, sectorId);
  if (!sector.profile) {
    throw new DomainError(
      "invalid_input",
      `sector "${sector.name}" has no profile; set one with sector_profile_set before running the preflight`,
    );
  }
  return parseSectorProfile(sector.profile);
}

export async function getProfileOrNull(db: Db, sectorId: string): Promise<SectorProfile | null> {
  const sector = await loadSectorRow(db, sectorId);
  return sector.profile ? parseSectorProfile(sector.profile) : null;
}

/**
 * Profile for reading paths (scope, pipeline): the stored profile, or the
 * skincare seed for the sector named skincare (migration 0030 seeds it in
 * real data; this keeps older rows and tests working). Any other sector
 * without a profile is refused in plain words.
 */
export async function resolveProfileForSector(db: Db, sectorId: string): Promise<SectorProfile> {
  const sector = await loadSectorRow(db, sectorId);
  if (sector.profile) return parseSectorProfile(sector.profile);
  if (sector.name.trim().toLowerCase() === "skincare") return SKINCARE_PROFILE;
  throw new DomainError(
    "invalid_input",
    `sector "${sector.name}" has no profile; set one with sector_profile_set before running the preflight`,
  );
}

export interface SetProfileResult {
  profile: SectorProfile;
  before: EligibilityCounts;
  after: EligibilityCounts;
  reclassifyPending: number;
  rubricApplied: boolean;
}

/**
 * Store a profile. Scope/rubric-only edits re-derive instantly. Changing
 * category keys after classifications exist is refused unless
 * `reclassify: true`, which marks classified memberships pending again.
 */
export async function setProfile(
  db: Db,
  sectorId: string,
  value: unknown,
  options: { reclassify?: boolean } = {},
): Promise<SetProfileResult> {
  const sector = await loadSectorRow(db, sectorId);
  const profile = parseSectorProfile(value);
  // A rubric included in the profile goes through the same validated path
  // as sector_rules_set, checked against the new categories up front so a
  // bad rubric stores nothing.
  const { eligibilityRubricSchema, parseEligibilityRubric, setRubric } = await import("./eligibility.js");
  const includedRubric =
    profile.rubric !== undefined ? parseEligibilityRubric(profile.rubric, profile) : null;
  const rubricParsed = sector.eligibilityRules
    ? eligibilityRubricSchema.safeParse(sector.eligibilityRules)
    : null;
  if (rubricParsed && !rubricParsed.success) {
    throw new DomainError("invalid_input", "stored rubric is invalid; set it again");
  }
  // Only a stored rubric constrains the new profile (and only when the call
  // does not replace it in the same step); a sector without one gets its
  // rubric validated when the rubric itself is set.
  if (rubricParsed?.data && !includedRubric) validateRubricAgainstProfile(rubricParsed.data, profile);

  const before = await eligibilityCounts(db, sectorId);
  const existing = sector.profile ? parseSectorProfile(sector.profile) : null;
  const keysChanged =
    existing !== null &&
    JSON.stringify([...categoryKeys(existing)].sort()) !== JSON.stringify([...categoryKeys(profile)].sort());
  let reclassifyPending = 0;
  const classified = await db
    .select({ companyId: sectorPreflight.companyId })
    .from(sectorPreflight)
    .where(eq(sectorPreflight.sectorId, sectorId));
  if (keysChanged && classified.length > 0) {
    if (!options.reclassify) {
      throw new DomainError(
        "conflict",
        "category keys changed after classifications exist; pass reclassify: true to mark them pending and re-run the preflight",
      );
    }
    reclassifyPending = classified.length;
  }
  await db
    .update(sectors)
    .set({ profile: profile as unknown as Record<string, unknown> })
    .where(eq(sectors.id, sectorId));
  if (includedRubric) await setRubric(db, sectorId, includedRubric);
  if (reclassifyPending > 0) {
    // Pending marking wins over any re-derivation above: the stored
    // classifications were made with the old category keys.
    await db
      .update(sectorCompanies)
      .set({
        eligibility: "pending",
        eligibilitySource: null,
        eligibilityReason: "profile categories changed; reclassification pending",
      })
      .where(eq(sectorCompanies.sectorId, sectorId));
  } else if (classified.length > 0) {
    // Scope edits re-derive instantly (no LLM), like rubric edits.
    const { applySectorScope } = await import("./eligibility.js");
    await applySectorScope(db, sectorId);
  }
  const after = await eligibilityCounts(db, sectorId);
  return { profile, before, after, reclassifyPending, rubricApplied: includedRubric !== null };
}

export { PRIMARY_CATEGORIES };
