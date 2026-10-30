import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { sectorCompanies, sectorPreflight, sectors } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { BUSINESS_TYPES } from "./classify.js";
import { eligibilityCounts, type EligibilityCounts } from "./eligibility.js";

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

/** RIA thresholds from docs/sectors/ria/icp.md sections 1-3 (Stage 5.7 B1). */
export const riaThresholdsSchema = z
  .object({
    maxAum: z.number().positive(),
    maxEmployees: z.number().int().positive(),
    minEmployees: z.number().int().min(0),
    minWealthShare: z.number().min(0).max(1),
    groupSplitAum: z.number().positive(),
  })
  .strict();

export type RiaThresholds = z.infer<typeof riaThresholdsSchema>;

export const DEFAULT_RIA_THRESHOLDS: RiaThresholds = {
  maxAum: 10_000_000_000,
  maxEmployees: 100,
  minEmployees: 2,
  minWealthShare: 0.5,
  groupSplitAum: 500_000_000,
};

const DEFAULT_TIERING = {
  apolloMinPerStaff: 75_000,
  staffEstimatePerHead: 175_000,
  publicCheckPerStaff: 1_000_000,
  pressSources: [] as string[],
};

export const sectorProfileSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    playbook: z.enum(["d2c", "ria"]).default("d2c"),
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
        businessTypes: z.array(z.string().min(1)).min(1).max(30).optional(),
        requireSellsOwnProducts: z.boolean().optional(),
        requireHasOnlineStore: z.boolean().optional(),
      })
      .strict(),
    classifierHints: z
      .object({
        serviceExamples: z.string().max(500),
        retailerExamples: z.string().max(500),
        supplierExamples: z.string().max(500),
      })
      .strict()
      .optional(),
    tiering: z
      .object({
        apolloMinPerStaff: z.number().positive().optional(),
        staffEstimatePerHead: z.number().positive().optional(),
        publicCheckPerStaff: z.number().positive().optional(),
        pressSources: z.array(z.string().min(1).max(120)).max(50).optional(),
      })
      .strict()
      .optional(),
    promptHints: z
      .object({
        retailerExamples: z.string().max(300),
        priceTiers: z.string().max(300),
        productClaims: z.string().max(300),
        positioningStory: z.string().max(300),
      })
      .strict()
      .optional(),
    ria: riaThresholdsSchema.optional(),
  })
  .strict();

export interface SectorProfile {
  name?: string;
  description?: string;
  playbook: "d2c" | "ria";
  categories: { key: string; label: string; description: string }[];
  scope: {
    coreCategories: string[];
    adjacentCategories: string[];
    scopeKeywords: string[];
    businessTypes: string[];
    requireSellsOwnProducts: boolean;
    requireHasOnlineStore: boolean;
  };
  classifierHints: { serviceExamples: string; retailerExamples: string; supplierExamples: string };
  tiering: {
    apolloMinPerStaff: number;
    staffEstimatePerHead: number;
    publicCheckPerStaff: number;
    pressSources: string[];
  };
  promptHints: { retailerExamples: string; priceTiers: string; productClaims: string; positioningStory: string };
  ria?: RiaThresholds;
}

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
  for (const type of profile.scope.businessTypes ?? []) {
    if (!(BUSINESS_TYPES as readonly string[]).includes(type)) {
      throw new DomainError("invalid_input", `invalid sector profile: scope lists unknown business_type "${type}"`);
    }
  }
  if (profile.playbook === "ria") {
    if (!profile.ria) {
      throw new DomainError("invalid_input", "invalid sector profile: ria playbook requires a ria block");
    }
    const normalized: SectorProfile = {
      ...(profile.name !== undefined ? { name: profile.name } : {}),
      ...(profile.description !== undefined ? { description: profile.description } : {}),
      playbook: "ria",
      categories: profile.categories,
      scope: {
        coreCategories: profile.scope.coreCategories,
        adjacentCategories: profile.scope.adjacentCategories,
        scopeKeywords: profile.scope.scopeKeywords,
        businessTypes: profile.scope.businessTypes ?? [],
        requireSellsOwnProducts: profile.scope.requireSellsOwnProducts ?? false,
        requireHasOnlineStore: profile.scope.requireHasOnlineStore ?? false,
      },
      classifierHints: profile.classifierHints ?? { serviceExamples: "", retailerExamples: "", supplierExamples: "" },
      tiering: {
        apolloMinPerStaff: profile.tiering?.apolloMinPerStaff ?? DEFAULT_TIERING.apolloMinPerStaff,
        staffEstimatePerHead: profile.tiering?.staffEstimatePerHead ?? DEFAULT_TIERING.staffEstimatePerHead,
        publicCheckPerStaff: profile.tiering?.publicCheckPerStaff ?? DEFAULT_TIERING.publicCheckPerStaff,
        pressSources: profile.tiering?.pressSources ?? [],
      },
      promptHints: profile.promptHints ?? { retailerExamples: "", priceTiers: "", productClaims: "", positioningStory: "" },
      ria: profile.ria,
    };
    return normalized;
  }
  // d2c: every D2C-only field is required, exactly as before Stage 5.7.
  if (profile.ria) {
    throw new DomainError("invalid_input", "invalid sector profile: ria block requires playbook ria");
  }
  if (!profile.scope.businessTypes || profile.scope.businessTypes.length === 0) {
    throw new DomainError("invalid_input", "invalid sector profile: scope.businessTypes: required for d2c");
  }
  if (profile.scope.requireSellsOwnProducts === undefined) {
    throw new DomainError("invalid_input", "invalid sector profile: scope.requireSellsOwnProducts: required for d2c");
  }
  if (profile.scope.requireHasOnlineStore === undefined) {
    throw new DomainError("invalid_input", "invalid sector profile: scope.requireHasOnlineStore: required for d2c");
  }
  if (!profile.classifierHints) {
    throw new DomainError("invalid_input", "invalid sector profile: classifierHints: required for d2c");
  }
  if (
    !profile.tiering ||
    profile.tiering.apolloMinPerStaff === undefined ||
    profile.tiering.staffEstimatePerHead === undefined ||
    profile.tiering.publicCheckPerStaff === undefined ||
    profile.tiering.pressSources === undefined
  ) {
    throw new DomainError("invalid_input", "invalid sector profile: tiering: required for d2c");
  }
  if (!profile.promptHints) {
    throw new DomainError("invalid_input", "invalid sector profile: promptHints: required for d2c");
  }
  const normalizedD2c: SectorProfile = {
    ...(profile.name !== undefined ? { name: profile.name } : {}),
    ...(profile.description !== undefined ? { description: profile.description } : {}),
    playbook: "d2c",
    categories: profile.categories,
    scope: {
      coreCategories: profile.scope.coreCategories,
      adjacentCategories: profile.scope.adjacentCategories,
      scopeKeywords: profile.scope.scopeKeywords,
      businessTypes: profile.scope.businessTypes,
      requireSellsOwnProducts: profile.scope.requireSellsOwnProducts,
      requireHasOnlineStore: profile.scope.requireHasOnlineStore,
    },
    classifierHints: profile.classifierHints,
    tiering: {
      apolloMinPerStaff: profile.tiering.apolloMinPerStaff,
      staffEstimatePerHead: profile.tiering.staffEstimatePerHead,
      publicCheckPerStaff: profile.tiering.publicCheckPerStaff,
      pressSources: profile.tiering.pressSources,
    },
    promptHints: profile.promptHints,
  };
  return normalizedD2c;
}

export function categoryKeys(profile: SectorProfile): string[] {
  return profile.categories.map((c) => c.key);
}

/** Stable hash of the category keys a classification was made with. */
export function profileHash(profile: SectorProfile): string {
  return createHash("sha256").update(categoryKeys(profile).join(",")).digest("hex").slice(0, 16);
}

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

export interface SetProfileResult {
  profile: SectorProfile;
  before: EligibilityCounts;
  after: EligibilityCounts;
  reclassifyPending: number;
  changedFields: string[];
}

/**
 * Store a profile. Scope-only edits re-derive instantly. Changing
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

  const before = await eligibilityCounts(db, sectorId);
  let existing: SectorProfile | null = null;
  if (sector.profile) {
    try {
      existing = parseSectorProfile(sector.profile);
    } catch {
      existing = null;
    }
  }
  const changedFields: string[] = [];
  if (existing) {
    const topKeys = ["name", "description", "playbook", "categories", "scope", "classifierHints", "tiering", "promptHints", "ria"] as const;
    for (const key of topKeys) {
      if (JSON.stringify(existing[key] ?? null) !== JSON.stringify(profile[key] ?? null)) changedFields.push(key);
    }
  } else {
    changedFields.push("playbook", "categories", "scope", "classifierHints", "tiering", "promptHints");
    if (profile.playbook === "ria") changedFields.push("ria");
  }
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
    const { rederiveSectorScope } = await import("./eligibility.js");
    await rederiveSectorScope(db, sectorId);
  }
  const after = await eligibilityCounts(db, sectorId);
  return { profile, before, after, reclassifyPending, changedFields };
}

