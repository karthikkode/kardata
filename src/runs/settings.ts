import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { harnessSettings } from "../db/schema.js";
import { DomainError } from "../domain/errors.js";

/**
 * Harness settings (Stage 4.1 Step 5): runtime-adjustable knobs stored in
 * the DB so the operator can change agent concurrency without a restart.
 * Effective value: explicit override, else the DB row, else
 * MAX_CONCURRENT_AGENTS, else the default.
 */

export const DEFAULT_MAX_AGENTS = 4;
export const MAX_AGENTS_MIN = 1;
export const MAX_AGENTS_MAX = 8;

const MAX_AGENTS_KEY = "max_concurrent_agents";

export function agentConcurrency(): number {
  const raw = process.env.MAX_CONCURRENT_AGENTS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_AGENTS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_AGENTS;
}

export interface HarnessSettingsView {
  maxConcurrentAgents: number;
  /** Where the effective value came from. */
  source: "db" | "env" | "default";
  /** The stored DB value, if any. */
  dbValue: number | null;
}

function validStored(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= MAX_AGENTS_MIN && value <= MAX_AGENTS_MAX
    ? value
    : null;
}

export async function harnessSettingsGet(db: Db): Promise<HarnessSettingsView> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, MAX_AGENTS_KEY));
  const dbValue = row ? validStored(row.value) : null;
  if (dbValue !== null) return { maxConcurrentAgents: dbValue, source: "db", dbValue };
  const raw = process.env.MAX_CONCURRENT_AGENTS;
  if (raw !== undefined && raw !== "") {
    return { maxConcurrentAgents: agentConcurrency(), source: "env", dbValue: null };
  }
  return { maxConcurrentAgents: DEFAULT_MAX_AGENTS, source: "default", dbValue: null };
}

export async function harnessSettingsSet(db: Db, maxConcurrentAgents: number): Promise<HarnessSettingsView> {
  if (!Number.isInteger(maxConcurrentAgents) || maxConcurrentAgents < MAX_AGENTS_MIN || maxConcurrentAgents > MAX_AGENTS_MAX) {
    throw new DomainError(
      "invalid_input",
      `maxConcurrentAgents must be ${MAX_AGENTS_MIN}..${MAX_AGENTS_MAX}`,
    );
  }
  await db
    .insert(harnessSettings)
    .values({ key: MAX_AGENTS_KEY, value: maxConcurrentAgents, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: harnessSettings.key,
      set: { value: maxConcurrentAgents, updatedAt: new Date() },
    });
  return { maxConcurrentAgents, source: "db", dbValue: maxConcurrentAgents };
}

/** Effective agent concurrency for this tick. Never throws on a bad row. */
export async function effectiveMaxAgents(db: Db, override?: number): Promise<number> {
  if (override !== undefined) return override;
  try {
    return (await harnessSettingsGet(db)).maxConcurrentAgents;
  } catch {
    return agentConcurrency();
  }
}

// ---- Company jobs: how many companies run concurrently (Stage 5). ----

export const DEFAULT_COMPANY_CONCURRENCY = 4;
export const COMPANY_CONCURRENCY_MIN = 1;
export const COMPANY_CONCURRENCY_MAX = 100;

const COMPANY_CONCURRENCY_KEY = "company_concurrency";

export function companyConcurrency(): number {
  const raw = process.env.COMPANY_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_COMPANY_CONCURRENCY;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_COMPANY_CONCURRENCY;
}

export interface CompanySettingsView {
  companyConcurrency: number;
  /** Where the effective value came from. */
  source: "db" | "env" | "default";
  /** The stored DB value, if any. */
  dbValue: number | null;
}

function validCompanyStored(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= COMPANY_CONCURRENCY_MIN &&
    value <= COMPANY_CONCURRENCY_MAX
    ? value
    : null;
}

export async function companySettingsGet(db: Db): Promise<CompanySettingsView> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, COMPANY_CONCURRENCY_KEY));
  const dbValue = row ? validCompanyStored(row.value) : null;
  if (dbValue !== null) return { companyConcurrency: dbValue, source: "db", dbValue };
  const raw = process.env.COMPANY_CONCURRENCY;
  if (raw !== undefined && raw !== "") {
    return { companyConcurrency: companyConcurrency(), source: "env", dbValue: null };
  }
  return { companyConcurrency: DEFAULT_COMPANY_CONCURRENCY, source: "default", dbValue: null };
}

export async function companySettingsSet(db: Db, value: number): Promise<CompanySettingsView> {
  if (
    !Number.isInteger(value) ||
    value < COMPANY_CONCURRENCY_MIN ||
    value > COMPANY_CONCURRENCY_MAX
  ) {
    throw new DomainError(
      "invalid_input",
      `companyConcurrency must be ${COMPANY_CONCURRENCY_MIN}..${COMPANY_CONCURRENCY_MAX}`,
    );
  }
  await db
    .insert(harnessSettings)
    .values({ key: COMPANY_CONCURRENCY_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: harnessSettings.key,
      set: { value, updatedAt: new Date() },
    });
  return { companyConcurrency: value, source: "db", dbValue: value };
}

/** Effective company concurrency for this tick. Never throws on a bad row. */
export async function effectiveCompanyConcurrency(db: Db, override?: number): Promise<number> {
  if (override !== undefined) return override;
  try {
    return (await companySettingsGet(db)).companyConcurrency;
  } catch {
    return companyConcurrency();
  }
}
