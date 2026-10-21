import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toEffectiveCompany } from "../domain/companies.js";
import { DomainError } from "../domain/errors.js";
import { ADAPTERS } from "../collect/adapters.js";
import type { PromptContext } from "./agent-runner.js";

/** Versioned research prompts: v0 is one file; v1+ is main.md plus area briefs. */

const TECH_LIST_MAX = 30;
const VERSION_PATTERN = /^v\d+(\.\d+)*$/;

// Plan order; every versioned prompt must carry all seven.
export const PROMPT_AREAS = [
  "reviews",
  "product",
  "marketing",
  "business_model",
  "hiring",
  "financials",
  "decisions",
] as const;

export function promptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "prompts");
}

function compareVersions(a: string, b: string): number {
  const pa = a.slice(1).split(".").map(Number);
  const pb = b.slice(1).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function availablePromptVersions(): string[] {
  const dir = promptsDir();
  const entries = readdirSync(dir);
  const versions: string[] = [];
  for (const entry of entries) {
    const file = entry.match(/^research-(v\d+(?:\.\d+)*)\.md$/);
    if (file?.[1]) {
      versions.push(file[1]);
      continue;
    }
    const folder = entry.match(/^(research-v\d+(?:\.\d+)*)$/);
    if (folder?.[1] && statSync(join(dir, entry)).isDirectory()) {
      versions.push(folder[1].replace(/^research-/, ""));
    }
  }
  return versions.sort(compareVersions);
}

export function latestPromptVersion(): string {
  const versions = availablePromptVersions();
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error("no research prompts found");
  return latest;
}

export function assertPromptVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new DomainError("invalid_input", `bad prompt version "${version}" (want v1, v1.1, ...)`);
  }
  const available = availablePromptVersions();
  if (!available.includes(version)) {
    throw new DomainError("invalid_input", `unknown prompt version "${version}" (have: ${available.join(", ")})`);
  }
  return version;
}

export function resolvePromptVersion(requested?: string): string {
  return requested === undefined ? latestPromptVersion() : assertPromptVersion(requested);
}

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

function substitute(template: string, values: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}

function templateValues(ctx: PromptContext): Record<string, string> {
  const effective = toEffectiveCompany(ctx.company);
  const briefSection =
    ctx.brief && ctx.brief.trim() !== "" ? `## Owner brief\n\n${ctx.brief.trim()}\n\n` : "";
  return {
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
}

function renderSingleFile(version: string, ctx: PromptContext): string {
  const template = readFileSync(join(promptsDir(), `research-${version}.md`), "utf8");
  return substitute(template, templateValues(ctx));
}

function renderVersioned(version: string, ctx: PromptContext): string {
  const base = join(promptsDir(), `research-${version}`);
  const main = readFileSync(join(base, "main.md"), "utf8");
  if (!main.includes("{{areaBriefs}}")) {
    throw new Error(`prompt ${version}/main.md has no {{areaBriefs}} placeholder`);
  }
  const briefs = PROMPT_AREAS.map((areaName) => {
    const path = join(base, "areas", `${areaName}.md`);
    if (!existsSync(path)) throw new Error(`prompt ${version} is missing areas/${areaName}.md`);
    return `### ${areaName}\n\n${readFileSync(path, "utf8").trim()}`;
  });
  const assembled = main.replace("{{areaBriefs}}", briefs.join("\n\n"));
  return substitute(assembled, templateValues(ctx));
}

export function templatePath(): string {
  return join(promptsDir(), "research-v0.md");
}

/**
 * Render the run's stored prompt version (pre-versioning runs render v0).
 * research_start resolves the default at creation, so this never picks latest
 * for a stored run.
 */
export function buildResearchPrompt(ctx: PromptContext): string {
  const version = ctx.run.promptVersion ?? "v0";
  assertPromptVersion(version);
  if (existsSync(join(promptsDir(), `research-${version}.md`))) return renderSingleFile(version, ctx);
  return renderVersioned(version, ctx);
}

/** Known collect adapters, one line each, for the preflight planner. */
export function preflightAdapterList(): string[] {
  return ADAPTERS.map((a) => `${a.id} (${a.blurb})`);
}

export function buildPreflightPrompt(ctx: PromptContext): string {
  const template = readFileSync(join(promptsDir(), "preflight-v1.md"), "utf8");
  return substitute(template, {
    ...templateValues(ctx),
    adapterList: preflightAdapterList()
      .map((line) => `- ${line}`)
      .join("\n"),
  });
}

/** Stage-aware entry: preflight runs get the recon prompt, everything else researches. */
export function buildStagePrompt(ctx: PromptContext): string {
  if (ctx.run.stage === "preflight") return buildPreflightPrompt(ctx);
  return buildResearchPrompt(ctx);
}
