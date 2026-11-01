import { execFile } from "node:child_process";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companyJobs, harnessSettings } from "../db/schema.js";
import { quotaBreakerGet, quotaEarlyTripRatioGet } from "../domain/quota/breaker.js";
import { tripQuotaBreaker } from "./company.js";
import { checkpointSet, pipelinePausedGet } from "./settings.js";

/**
 * Live quota monitor (Stage 5.2): polls the app account's real 5h/weekly
 * usage % and acts on it. 90% on either window freezes intake so running
 * jobs drain; 95% trips the breaker (AI halts, deterministic work flows,
 * auto-resume at the reported reset). Reads never break the wave: a failed
 * or empty read keeps the last snapshot and changes nothing.
 */

export const QUOTA_FREEZE_PCT = 90;
export const QUOTA_HALT_PCT = 95;
export const DEFAULT_QUOTA_MONITOR_POLL_MS = 300_000;

const SNAPSHOT_KEY = "quota_snapshot";
const FREEZE_KEY = "quota_freeze";

export interface QuotaReading {
  fivePct: number | null;
  fiveResetAt: string | null;
  weeklyPct: number | null;
  weeklyResetAt: string | null;
}

export interface QuotaSnapshot extends QuotaReading {
  checkedAt: string;
}

function validPct(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100 ? value : null;
}

function validIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : value;
}

function validReading(value: unknown): QuotaReading | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const reading: QuotaReading = {
    fivePct: validPct(v.fivePct),
    fiveResetAt: validIso(v.fiveResetAt),
    weeklyPct: validPct(v.weeklyPct),
    weeklyResetAt: validIso(v.weeklyResetAt),
  };
  return reading.fivePct === null && reading.weeklyPct === null ? null : reading;
}

export async function quotaSnapshotGet(db: Db): Promise<QuotaSnapshot | null> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, SNAPSHOT_KEY));
  const value = row?.value as (Record<string, unknown> & { checkedAt?: unknown }) | undefined;
  if (!value || typeof value !== "object") return null;
  const reading = validReading(value);
  const checkedAt = validIso(value.checkedAt);
  return reading && checkedAt ? { ...reading, checkedAt } : null;
}

async function quotaSnapshotSet(db: Db, reading: QuotaReading, now: string): Promise<void> {
  await db
    .insert(harnessSettings)
    .values({ key: SNAPSHOT_KEY, value: { ...reading, checkedAt: now }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: harnessSettings.key,
      set: { value: { ...reading, checkedAt: now }, updatedAt: new Date() },
    });
}

interface FreezeFlag {
  active: boolean;
  /** False when the pipeline was already paused: nothing of ours to undo. */
  targetSet: boolean;
}

async function freezeFlagGet(db: Db): Promise<FreezeFlag> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, FREEZE_KEY));
  const value = row?.value as Partial<FreezeFlag> | undefined;
  if (!value || value.active !== true) return { active: false, targetSet: false };
  return { active: true, targetSet: value.targetSet === true };
}

async function freezeFlagSet(db: Db, flag: FreezeFlag): Promise<void> {
  await db
    .insert(harnessSettings)
    .values({ key: FREEZE_KEY, value: { ...flag }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: harnessSettings.key,
      set: { value: { ...flag }, updatedAt: new Date() },
    });
}

async function freezeFlagClear(db: Db): Promise<void> {
  await db.delete(harnessSettings).where(eq(harnessSettings.key, FREEZE_KEY));
}

/** Production reader: runs scripts/quota-read.sh (usage fields only). */
export function readQuotaLive(): Promise<QuotaReading | null> {
  const script = path.join(process.cwd(), "scripts", "quota-read.sh");
  return new Promise((resolve) => {
    execFile(script, { timeout: 60000, maxBuffer: 4096 }, (err, stdout) => {
      if (err) {
        console.error(`quota monitor read failed: ${err.message}`);
        resolve(null);
        return;
      }
      try {
        resolve(validReading(JSON.parse(stdout)));
      } catch {
        console.error("quota monitor read failed: bad JSON");
        resolve(null);
      }
    });
  });
}

export interface QuotaMonitorDeps {
  pollMs?: number;
  clock?: () => Date;
  readUsage?: () => Promise<QuotaReading | null>;
}

export interface QuotaMonitor {
  poll: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

export function createQuotaMonitor(db: Db, deps: QuotaMonitorDeps = {}): QuotaMonitor {
  const pollMsRaw = deps.pollMs ?? Number(process.env.QUOTA_MONITOR_POLL_MS ?? DEFAULT_QUOTA_MONITOR_POLL_MS);
  const pollMs = Number.isInteger(pollMsRaw) && pollMsRaw > 0 ? pollMsRaw : DEFAULT_QUOTA_MONITOR_POLL_MS;
  const clock = deps.clock ?? (() => new Date());
  const readUsage = deps.readUsage ?? readQuotaLive;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function completedCount(): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(companyJobs)
      .where(eq(companyJobs.status, "completed"));
    return Number(row?.n ?? 0);
  }

  async function poll(): Promise<void> {
    let reading: QuotaReading | null;
    try {
      reading = await readUsage();
    } catch (err) {
      console.error(`quota monitor read failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!reading) return;
    const now = clock();
    await quotaSnapshotSet(db, reading, now.toISOString());
    // A trip owns halting and resuming; the monitor only records meanwhile.
    if ((await quotaBreakerGet(db)).tripped) return;
    const { fivePct, fiveResetAt, weeklyPct, weeklyResetAt } = reading;
    const freezeWanted = (fivePct ?? 0) >= QUOTA_FREEZE_PCT || (weeklyPct ?? 0) >= QUOTA_FREEZE_PCT;
    const { ratio } = await quotaEarlyTripRatioGet(db);
    const weeklyHaltPct = Math.max(QUOTA_HALT_PCT, Math.round(ratio * 100));
    const haltWindow =
      (weeklyPct ?? 0) >= weeklyHaltPct
        ? { name: "weekly", resetAt: weeklyResetAt }
        : (fivePct ?? 0) >= QUOTA_HALT_PCT
          ? { name: "5h", resetAt: fiveResetAt }
          : null;
    if (haltWindow) {
      const resetAt = haltWindow.resetAt ? new Date(haltWindow.resetAt) : null;
      await tripQuotaBreaker(db, {
        resumeAt: resetAt && !Number.isNaN(resetAt.getTime()) ? resetAt : null,
        estimated: false,
        error: `quota monitor: ${haltWindow.name} window at ${haltWindow.name === "weekly" ? weeklyPct : fivePct}%`,
      });
      return;
    }
    const flag = await freezeFlagGet(db);
    if (!freezeWanted) {
      if (flag.active) {
        // Usage fell back (a window reset): undo only our own freeze.
        if (flag.targetSet) await checkpointSet(db, null);
        await freezeFlagClear(db);
      }
      return;
    }
    if (flag.active) return;
    if ((await pipelinePausedGet(db)).paused) {
      await freezeFlagSet(db, { active: true, targetSet: false });
      return;
    }
    await checkpointSet(db, Math.max(1, await completedCount()));
    await freezeFlagSet(db, { active: true, targetSet: true });
  }

  return {
    poll,
    start: () => {
      if (timer) return;
      timer = setInterval(() => {
        void poll().catch((err: unknown) =>
          console.error(`quota monitor poll failed: ${err instanceof Error ? err.message : err}`),
        );
      }, pollMs);
      timer.unref?.();
      void poll().catch((err: unknown) =>
        console.error(`quota monitor poll failed: ${err instanceof Error ? err.message : err}`),
      );
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
