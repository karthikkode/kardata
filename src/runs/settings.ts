import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { harnessSettings } from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import {
  estimateInflightBurn,
  quotaBreakerGet,
  quotaCalibrationGet,
  windowBurn,
} from "../domain/quota/breaker.js";

/**
 * Harness settings (Stage 4.1 Step 5): runtime-adjustable knobs stored in
 * the DB so the operator can change agent concurrency without a restart.
 * Effective value: explicit override, else the DB row, else
 * MAX_CONCURRENT_AGENTS, else the default.
 */

export const DEFAULT_MAX_AGENTS = 4;
export const MAX_AGENTS_MIN = 1;
export const MAX_AGENTS_MAX = 64;

/** MemAvailable in MB from /proc/meminfo, or null when unreadable (non-Linux). */
export function systemMemAvailableMB(): number | null {
  try {
    const match = /MemAvailable:\s+(\d+)\s+kB/.exec(readFileSync("/proc/meminfo", "utf8"));
    if (!match?.[1]) return null;
    return Math.floor(Number(match[1]) / 1024);
  } catch {
    return null;
  }
}

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

/** Pacer floor: the wave always keeps a trickle of agents (the 95% early trip takes over near empty). */
export const QUOTA_PACER_FLOOR = 4;

/**
 * Fit agent launches to the window budget (metered burn plus estimated
 * in-flight burn): full speed while burn tracks time left, throttling as
 * burn outruns it. Uncalibrated (or an expired window) runs flat-out at
 * base; the first real 429 teaches the window. Never raises above the
 * operator's base. Feeder begins and engine launches both consume this,
 * so neither can bypass the other.
 */
export async function paceAgents(db: Db, base: number, now: Date = new Date()): Promise<number> {
  const cal = await quotaCalibrationGet(db);
  if (!cal || cal.allowanceEstimate <= 0 || !cal.windowMs || cal.windowMs <= 0) return base;
  const start = new Date(cal.windowStart).getTime();
  if (Number.isNaN(start)) return base;
  const fracLeft = (start + cal.windowMs - now.getTime()) / cal.windowMs;
  if (fracLeft <= 0) return base;
  const burn = await windowBurn(db, new Date(cal.windowStart));
  const inflight = await estimateInflightBurn(db, now);
  const remaining = cal.allowanceEstimate - burn - inflight;
  if (remaining <= 0) return Math.min(base, QUOTA_PACER_FLOOR);
  const ratio = remaining / cal.allowanceEstimate / fracLeft;
  return Math.min(base, Math.max(QUOTA_PACER_FLOOR, Math.ceil(base * ratio)));
}

/** Effective agent concurrency for this tick (paced to quota). Never throws on a bad row. */
export async function effectiveMaxAgents(db: Db, override?: number): Promise<number> {
  if (override !== undefined) return override;
  let base: number;
  try {
    base = (await harnessSettingsGet(db)).maxConcurrentAgents;
  } catch {
    return agentConcurrency();
  }
  try {
    return await paceAgents(db, base);
  } catch (err) {
    console.error(`quota pacer failed: ${err instanceof Error ? err.message : err}`);
    return base;
  }
}

/**
 * Collect concurrency: runtime-adjustable like agents (per-site
 * politeness lives in the fetcher, so distinct companies parallelize
 * freely). Effective value: explicit override, else the DB row, else
 * COLLECT_CONCURRENCY, else the default. While the quota breaker is
 * tripped the deterministic backlog drains wide open.
 */

export const DEFAULT_COLLECT_CONCURRENCY = 3;
export const COLLECT_MIN = 1;
export const COLLECT_MAX = 64;

const COLLECT_KEY = "collect_concurrency";

export interface CollectSettingsView {
  collectConcurrency: number;
  /** Where the effective value came from. */
  source: "db" | "env" | "default";
  /** The stored DB value, if any. */
  dbValue: number | null;
}

function validCollectStored(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= COLLECT_MIN && value <= COLLECT_MAX
    ? value
    : null;
}

export async function collectSettingsGet(db: Db): Promise<CollectSettingsView> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, COLLECT_KEY));
  const dbValue = row ? validCollectStored(row.value) : null;
  if (dbValue !== null) return { collectConcurrency: dbValue, source: "db", dbValue };
  const raw = process.env.COLLECT_CONCURRENCY;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    const env = Number.isInteger(n) && n > 0 ? n : DEFAULT_COLLECT_CONCURRENCY;
    return { collectConcurrency: env, source: "env", dbValue: null };
  }
  return { collectConcurrency: DEFAULT_COLLECT_CONCURRENCY, source: "default", dbValue: null };
}

export async function collectSettingsSet(db: Db, collectConcurrency: number): Promise<CollectSettingsView> {
  if (!Number.isInteger(collectConcurrency) || collectConcurrency < COLLECT_MIN || collectConcurrency > COLLECT_MAX) {
    throw new DomainError("invalid_input", `collectConcurrency must be ${COLLECT_MIN}..${COLLECT_MAX}`);
  }
  await db
    .insert(harnessSettings)
    .values({ key: COLLECT_KEY, value: collectConcurrency, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: harnessSettings.key,
      set: { value: collectConcurrency, updatedAt: new Date() },
    });
  return { collectConcurrency, source: "db", dbValue: collectConcurrency };
}

/** Effective collect width for this tick (wide open while tripped). Never throws on a bad row. */
export async function effectiveCollectLimit(db: Db, override?: number): Promise<number> {
  if (override !== undefined) return override;
  let base: number;
  try {
    base = (await collectSettingsGet(db)).collectConcurrency;
  } catch {
    return DEFAULT_COLLECT_CONCURRENCY;
  }
  try {
    if ((await quotaBreakerGet(db)).tripped) return COLLECT_MAX;
  } catch {
    // The monitor must never break the feeder.
  }
  return base;
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

// ---- Quality checkpoint: pause promotion after N completions (Stage 5+). ----

// DB-only by design (no env fallback): a checkpoint is an explicit operator
// act, and the pause record is written by the worker itself.

export const PAUSE_AFTER_COMPLETED_MIN = 1;
export const PAUSE_AFTER_COMPLETED_MAX = 1_000_000;

const PAUSE_AFTER_COMPLETED_KEY = "pause_after_completed";
const PIPELINE_PAUSED_KEY = "pipeline_paused";

function validCheckpointTarget(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= PAUSE_AFTER_COMPLETED_MIN &&
    value <= PAUSE_AFTER_COMPLETED_MAX
    ? value
    : null;
}

export interface CheckpointView {
  /** Complete-job count that trips the pause, or null when disabled. */
  target: number | null;
}

export async function checkpointGet(db: Db): Promise<CheckpointView> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, PAUSE_AFTER_COMPLETED_KEY));
  return { target: row ? validCheckpointTarget(row.value) : null };
}

export interface PipelinePausedView {
  paused: boolean;
  /** When the worker tripped the pause, if it did. */
  at: string | null;
  /** Completed-job count at the trip, if tripped. */
  completed: number | null;
  /** The target that tripped it, if tripped. */
  target: number | null;
}

const NOT_PAUSED: PipelinePausedView = { paused: false, at: null, completed: null, target: null };

export async function pipelinePausedGet(db: Db): Promise<PipelinePausedView> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, PIPELINE_PAUSED_KEY));
  const value = row?.value as { at?: unknown; completed?: unknown; target?: unknown } | undefined;
  if (!value || typeof value !== "object") return NOT_PAUSED;
  if (typeof value.at !== "string" || typeof value.completed !== "number" || typeof value.target !== "number") {
    return NOT_PAUSED;
  }
  return { paused: true, at: value.at, completed: value.completed, target: value.target };
}

/**
 * Set (or clear, with null) the checkpoint. Setting a target resumes the
 * pipeline: a new checkpoint means "carry on until N".
 */
export async function checkpointSet(db: Db, target: number | null): Promise<CheckpointView> {
  if (target !== null && validCheckpointTarget(target) === null) {
    throw new DomainError(
      "invalid_input",
      `afterCompleted must be ${PAUSE_AFTER_COMPLETED_MIN}..${PAUSE_AFTER_COMPLETED_MAX} or null`,
    );
  }
  if (target === null) {
    await db.delete(harnessSettings).where(eq(harnessSettings.key, PAUSE_AFTER_COMPLETED_KEY));
  } else {
    await db
      .insert(harnessSettings)
      .values({ key: PAUSE_AFTER_COMPLETED_KEY, value: target, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: harnessSettings.key,
        set: { value: target, updatedAt: new Date() },
      });
  }
  await db.delete(harnessSettings).where(eq(harnessSettings.key, PIPELINE_PAUSED_KEY));
  return { target };
}

/** Worker-only: record the checkpoint trip (idempotent). */
export async function tripPipelinePause(db: Db, target: number, completed: number): Promise<void> {
  await db
    .insert(harnessSettings)
    .values({
      key: PIPELINE_PAUSED_KEY,
      value: { at: new Date().toISOString(), completed, target },
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

// ---- Sector preflight pool: simultaneous classifier runs (Stage 5.1). ----

export const DEFAULT_SECTOR_PREFLIGHT_CONCURRENCY = 8;
export const SECTOR_PREFLIGHT_CONCURRENCY_MIN = 1;
export const SECTOR_PREFLIGHT_CONCURRENCY_MAX = 64;

const SECTOR_PREFLIGHT_CONCURRENCY_KEY = "sector_preflight_concurrency";

export function sectorPreflightConcurrency(): number {
  const raw = process.env.SECTOR_PREFLIGHT_CONCURRENCY;
  if (raw === undefined || raw === "") return DEFAULT_SECTOR_PREFLIGHT_CONCURRENCY;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SECTOR_PREFLIGHT_CONCURRENCY;
}

export interface SectorPreflightSettingsView {
  sectorPreflightConcurrency: number;
  source: "db" | "env" | "default";
  dbValue: number | null;
}

function validSectorPreflightStored(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SECTOR_PREFLIGHT_CONCURRENCY_MIN &&
    value <= SECTOR_PREFLIGHT_CONCURRENCY_MAX
    ? value
    : null;
}

export async function sectorPreflightSettingsGet(db: Db): Promise<SectorPreflightSettingsView> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, SECTOR_PREFLIGHT_CONCURRENCY_KEY));
  const dbValue = row ? validSectorPreflightStored(row.value) : null;
  if (dbValue !== null) return { sectorPreflightConcurrency: dbValue, source: "db", dbValue };
  const raw = process.env.SECTOR_PREFLIGHT_CONCURRENCY;
  if (raw !== undefined && raw !== "") {
    return { sectorPreflightConcurrency: sectorPreflightConcurrency(), source: "env", dbValue: null };
  }
  return { sectorPreflightConcurrency: DEFAULT_SECTOR_PREFLIGHT_CONCURRENCY, source: "default", dbValue: null };
}

export async function sectorPreflightSettingsSet(db: Db, value: number): Promise<SectorPreflightSettingsView> {
  if (
    !Number.isInteger(value) ||
    value < SECTOR_PREFLIGHT_CONCURRENCY_MIN ||
    value > SECTOR_PREFLIGHT_CONCURRENCY_MAX
  ) {
    throw new DomainError(
      "invalid_input",
      `sectorPreflightConcurrency must be ${SECTOR_PREFLIGHT_CONCURRENCY_MIN}..${SECTOR_PREFLIGHT_CONCURRENCY_MAX}`,
    );
  }
  await db
    .insert(harnessSettings)
    .values({ key: SECTOR_PREFLIGHT_CONCURRENCY_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: harnessSettings.key,
      set: { value, updatedAt: new Date() },
    });
  return { sectorPreflightConcurrency: value, source: "db", dbValue: value };
}

/** Effective sector-preflight pool size for this tick. Never throws on a bad row. */
export async function effectiveSectorPreflight(db: Db, override?: number): Promise<number> {
  if (override !== undefined) return override;
  try {
    return (await sectorPreflightSettingsGet(db)).sectorPreflightConcurrency;
  } catch {
    return sectorPreflightConcurrency();
  }
}
