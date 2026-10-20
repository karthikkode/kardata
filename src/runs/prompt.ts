import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toEffectiveCompany } from "../domain/companies.js";
import type { PromptContext } from "./agent-runner.js";

/** Minimal v0 research prompt (Stage 3b Step 3; Stage 4 replaces it). */

const TECH_LIST_MAX = 30;

function display(value: string | number | null): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string" && value.trim() === "") return "unknown";
  return String(value);
}

function apolloSummary(ctx: PromptContext): string {
  const effective = toEffectiveCompany(ctx.company);
  const parts: string[] = [];
  if (effective.annualRevenue) parts.push(`revenue ${effective.annualRevenue}`);
  if (effective.totalFunding) parts.push(`funding ${effective.totalFunding}`);
  if (effective.foundedYear !== null && effective.foundedYear !== undefined) {
    parts.push(`founded ${effective.foundedYear}`);
  }
  if (effective.technologies.length > 0) {
    const shown = effective.technologies.slice(0, TECH_LIST_MAX).join(", ");
    const extra =
      effective.technologies.length > TECH_LIST_MAX
        ? ` (+${effective.technologies.length - TECH_LIST_MAX} more)`
        : "";
    parts.push(`tech: ${shown}${extra}`);
  }
  return parts.length > 0 ? parts.join("; ") : "no Apollo data";
}

export function templatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "prompts", "research-v0.md");
}

export function buildResearchPrompt(ctx: PromptContext): string {
  const effective = toEffectiveCompany(ctx.company);
  const template = readFileSync(templatePath(), "utf8");
  const briefSection =
    ctx.brief && ctx.brief.trim() !== "" ? `## Owner brief\n\n${ctx.brief.trim()}\n\n` : "";
  const values: Record<string, string> = {
    runId: ctx.run.id,
    companyId: ctx.company.id,
    name: display(effective.name),
    domain: display(effective.domain),
    website: display(effective.website),
    country: display(effective.country),
    employees: display(effective.employees),
    industry: display(effective.industry),
    apolloSummary: apolloSummary(ctx),
    briefSection,
  };
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}
