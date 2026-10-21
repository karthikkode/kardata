import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Company } from "../../db/schema.js";
import { toEffectiveCompany } from "../companies.js";
import { DomainError } from "../errors.js";

/** Sector-preflight classifier I/O (Stage 5.1 Step 1). */

export const BUSINESS_TYPES = [
  "dtc_brand",
  "brand_retail_only",
  "clinic_medical",
  "spa_salon",
  "retailer_marketplace",
  "distributor_wholesaler",
  "manufacturer_private_label",
  "agency_service",
  "ingredient_supplier",
  "other",
  "site_dead_or_parked",
  "unknown",
] as const;

export const PRIMARY_CATEGORIES = [
  "skincare",
  "haircare",
  "cosmetics_makeup",
  "body_bath",
  "fragrance",
  "supplements_wellness",
  "mens_grooming",
  "other",
] as const;

export const classificationSchema = z.object({
  business_type: z.enum(BUSINESS_TYPES),
  primary_category: z.enum(PRIMARY_CATEGORIES),
  sells_own_products: z.boolean(),
  has_online_store: z.boolean(),
  ships_to: z.array(z.string().min(1).max(120)).max(50),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().min(1).max(500),
  quote: z.string().max(2000).nullable(),
  quote_source_id: z.string().uuid().nullable(),
});

export type Classification = z.infer<typeof classificationSchema>;

export function parseClassification(value: unknown): Classification {
  const parsed = classificationSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    throw new DomainError("invalid_input", `invalid classification: ${where}${first?.message ?? "rejected"}`);
  }
  if ((parsed.data.quote ?? null) === null && parsed.data.quote_source_id !== null) {
    throw new DomainError("invalid_input", "invalid classification: quote_source_id without a quote");
  }
  return parsed.data;
}

function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "prompts", "sector-preflight-v1");
}

export function classifierSchema(): string {
  return readFileSync(join(promptsDir(), "schema.json"), "utf8");
}

export interface ClassifierPage {
  sourceId: string;
  url: string;
  text: string;
}

export interface ClassifierInput {
  company: Company;
  description: string | null;
  pages: ClassifierPage[];
  shopify: string | null;
  apolloOnly: boolean;
}

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string" && value.trim() === "") return "unknown";
  return String(value);
}

/** Apollo record block: industry, keywords, description, employees, country. */
export function apolloBlock(company: Company, description: string | null): string {
  const effective = toEffectiveCompany(company);
  const lines = [
    `name: ${display(effective.name)}`,
    `domain: ${display(effective.domain)}`,
    `industry: ${display(effective.industry)}`,
    `keywords: ${effective.keywords.length > 0 ? effective.keywords.slice(0, 15).join(", ") : "unknown"}`,
    `employees: ${display(effective.employees)}`,
    `country: ${display(effective.country)}`,
    `description: ${description && description.trim() !== "" ? description.trim().slice(0, 500) : "unknown"}`,
  ];
  return lines.join("\n");
}

export function buildClassifierPrompt(input: ClassifierInput): string {
  const template = readFileSync(join(promptsDir(), "prompt.md"), "utf8");
  const sourceList = input.pages.length > 0 ? input.pages.map((p) => p.sourceId).join(", ") : "none (Apollo-only)";
  const pages =
    input.pages.length > 0
      ? input.pages.map((p) => `### ${p.sourceId}\n${p.url}\n${p.text}`).join("\n\n")
      : "(no pages fetched — classify from the Apollo record only, with low confidence)";
  return template
    .split("{{apollo}}")
    .join(apolloBlock(input.company, input.description))
    .split("{{shopify}}")
    .join(input.shopify ?? "not checked")
    .split("{{sourceList}}")
    .join(sourceList)
    .split("{{pages}}")
    .join(pages);
}
