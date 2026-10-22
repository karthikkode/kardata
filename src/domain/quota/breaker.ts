import { eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { harnessSettings, providerCalls } from "../../db/schema.js";

/**
 * Quota circuit breaker state. There is no provider quota-% API: the only
 * ground truth is the "Subscription quota exhausted ... resets at <ts>"
 * error text. The breaker trips on that (exact resume time), and trips
 * early at 95% of the learned window burn once calibrated.
 */
export const QUOTA_BREAKER_KEY = "quota_breaker";
export const QUOTA_CALIBRATION_KEY = "quota_calibration";
export const QUOTA_EARLY_TRIP_RATIO = 0.95;

export interface QuotaTrip {
  trippedAt: string;
  resumeAt: string | null;
  estimated: boolean;
  jobIds: string[];
  error: string;
}

export interface QuotaCalibration {
  windowStart: string;
  allowanceEstimate: number;
  windowMs: number | null;
  earlyTrips: string[];
}

export function parseQuotaExhaustion(error: string): { exhausted: boolean; resumeAt: Date | null } {
  if (!/subscription quota exhausted/i.test(error)) return { exhausted: false, resumeAt: null };
  const match = /resets?\s+at\s+(\S+)/i.exec(error);
  if (!match?.[1]) return { exhausted: true, resumeAt: null };
  const resumeAt = new Date(match[1].replace(/[.,;]+$/, ""));
  return { exhausted: true, resumeAt: Number.isNaN(resumeAt.getTime()) ? null : resumeAt };
}

async function readKey(db: Db, key: string): Promise<Record<string, unknown> | null> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, key));
  const value = row?.value as Record<string, unknown> | undefined;
  return value && typeof value === "object" ? value : null;
}

async function writeKey(db: Db, key: string, value: Record<string, unknown>): Promise<void> {
  await db
    .insert(harnessSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: harnessSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function quotaBreakerGet(db: Db): Promise<{ tripped: false } | ({ tripped: true } & QuotaTrip)> {
  const value = await readKey(db, QUOTA_BREAKER_KEY);
  if (!value || typeof value.trippedAt !== "string" || !Array.isArray(value.jobIds)) {
    return { tripped: false };
  }
  return {
    tripped: true,
    trippedAt: value.trippedAt,
    resumeAt: typeof value.resumeAt === "string" ? value.resumeAt : null,
    estimated: value.estimated === true,
    jobIds: value.jobIds.filter((id): id is string => typeof id === "string"),
    error: typeof value.error === "string" ? value.error : "",
  };
}

export async function quotaBreakerSet(db: Db, trip: QuotaTrip): Promise<void> {
  await writeKey(db, QUOTA_BREAKER_KEY, { ...trip });
}

export async function quotaBreakerClear(db: Db): Promise<void> {
  await db.delete(harnessSettings).where(eq(harnessSettings.key, QUOTA_BREAKER_KEY));
}

export async function quotaCalibrationGet(db: Db): Promise<QuotaCalibration | null> {
  const value = await readKey(db, QUOTA_CALIBRATION_KEY);
  if (!value || typeof value.windowStart !== "string" || typeof value.allowanceEstimate !== "number") {
    return null;
  }
  return {
    windowStart: value.windowStart,
    allowanceEstimate: value.allowanceEstimate,
    windowMs: typeof value.windowMs === "number" ? value.windowMs : null,
    earlyTrips: Array.isArray(value.earlyTrips)
      ? value.earlyTrips.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export async function quotaCalibrationSet(db: Db, calibration: QuotaCalibration): Promise<void> {
  await writeKey(db, QUOTA_CALIBRATION_KEY, { ...calibration, earlyTrips: calibration.earlyTrips.slice(-5) });
}

/** Our own metered burn (input + cached) since `since`, or all-time when null. */
export async function windowBurn(db: Db, since: Date | null): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${providerCalls.inputTokens} + ${providerCalls.cachedTokens}), 0)::int` })
    .from(providerCalls)
    .where(since ? gte(providerCalls.at, since) : undefined);
  return Number(row?.total ?? 0);
}
