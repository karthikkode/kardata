import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { harnessSettings, researchRuns } from "../../db/schema.js";
import { CODEX_MODEL, CODEX_CONTEXT, CODEX_REASONING } from "../../harness/codex-config.js";
import { CodexCallError, dockerCodexExtractorCall } from "../../harness/codex-extract.js";
import { codexHasCapacity, readCodexSnapshot, type CodexSnapshot } from "../../harness/codex-status.js";
import { dockerExtractorCall, type ExtractorCall } from "../../runs/extract.js";
import { quotaBreakerGet, quotaEarlyTripRatioGet, quotaSnapshotWeeklyPct } from "../quota/breaker.js";
import { logExtractorCall } from "../logging/provider-calls.js";

export type RiaProvider = "muse" | "codex";
export type RiaProviderMode = RiaProvider | "auto";
const MODE_KEY = "ria_extractor_provider";
const SNAPSHOT_KEY = "ria_codex_snapshot";
const HOLD_KEY = "ria_codex_hold";
const context = new AsyncLocalStorage<RiaProvider>();
const refreshing = new WeakMap<Db, Promise<CodexSnapshot>>();

async function read(db: Db, key: string): Promise<unknown> {
  const [r] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, key));
  return r?.value;
}
async function save(db: Db, key: string, value: unknown): Promise<void> {
  await db.insert(harnessSettings).values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: harnessSettings.key, set: { value, updatedAt: new Date() } });
}
export async function riaProviderMode(db: Db): Promise<RiaProviderMode> {
  const v = await read(db, MODE_KEY) as { mode?: unknown } | undefined;
  return v?.mode === "codex" || v?.mode === "auto" ? v.mode : "muse";
}
export async function setRiaProviderMode(db: Db, mode: RiaProviderMode): Promise<void> { await save(db, MODE_KEY, { mode }); }

export async function codexSnapshot(db: Db, refresh = false): Promise<CodexSnapshot | null> {
  const stored = await read(db, SNAPSHOT_KEY) as CodexSnapshot | undefined;
  if (!refresh && stored && Date.now() - Date.parse(stored.checkedAt) < 60000) return stored;
  let work = refreshing.get(db);
  if (!work) {
    work = readCodexSnapshot().then(async (snapshot) => {
      await save(db, SNAPSHOT_KEY, snapshot);
      return snapshot;
    }).finally(() => refreshing.delete(db));
    refreshing.set(db, work);
  }
  return work;
}

interface CodexHold { kind: "quota" | "auth"; at: string; resumeAt: string | null }
async function codexHeld(db: Db, snapshot: CodexSnapshot | null): Promise<boolean> {
  const hold = await read(db, HOLD_KEY) as CodexHold | null | undefined;
  if (!hold?.kind) return false;
  if (snapshot && codexHasCapacity(snapshot) &&
      ((hold.kind === "auth" && Date.parse(snapshot.checkedAt) > Date.parse(hold.at)) ||
       (hold.resumeAt !== null && Date.now() >= Date.parse(hold.resumeAt)))) {
    await save(db, HOLD_KEY, {}); return false;
  }
  return true;
}

export async function markCodexHold(db: Db, kind: "quota" | "auth"): Promise<void> {
  const snapshot = await codexSnapshot(db, true);
  const blocked = [snapshot?.primary, snapshot?.secondary].filter((w) => w && w.usedPercent >= (w.windowMinutes >= 10080 ? 100 : 95));
  const resets = blocked.map((w) => Date.parse(w!.resetsAt)).filter((n) => Number.isFinite(n) && n > Date.now());
  await save(db, HOLD_KEY, { kind, at: new Date().toISOString(), resumeAt: resets.length ? new Date(Math.max(...resets)).toISOString() : null });
}

/** Muse retains its own breaker. Codex availability is checked against its separate real quota snapshot. */
export async function riaProviderGate(db: Db) {
  const mode = await riaProviderMode(db);
  const [trip, snap, setting] = await Promise.all([quotaBreakerGet(db), quotaSnapshotWeeklyPct(db), quotaEarlyTripRatioGet(db)]);
  const museHeld = trip.tripped || (snap.weeklyPct !== null && snap.weeklyPct >= setting.ratio * 100);
  let museReady = !museHeld;
  if (mode === "auto") {
    const meter = await read(db, "quota_snapshot") as Record<string, unknown> | undefined;
    const age = Date.now() - Date.parse(String(meter?.checkedAt ?? ""));
    museReady = museReady && Number.isFinite(age) && age >= -5000 && age <= 600000 &&
      typeof meter?.fivePct === "number" && meter.fivePct >= 0 && meter.fivePct < 95 &&
      typeof meter.weeklyPct === "number" && meter.weeklyPct >= 0 && meter.weeklyPct < setting.ratio * 100 &&
      Date.parse(String(meter.fiveResetAt ?? "")) > Date.now() && Date.parse(String(meter.weeklyResetAt ?? "")) > Date.now();
  }
  const provider: RiaProvider = mode === "codex" || (mode === "auto" && !museReady) ? "codex" : "muse";
  if (provider === "muse") return { mode, provider, available: !museHeld, reason: museHeld ? "muse_quota" : null };
  const snapshot = await codexSnapshot(db);
  const held = await codexHeld(db, snapshot);
  return { mode, provider, available: snapshot !== null && codexHasCapacity(snapshot) && !held,
    reason: held ? "codex_provider_hold" : snapshot?.error ?? (snapshot && codexHasCapacity(snapshot) ? null : "codex_quota") };
}

export async function riaProviderStatus(db: Db, refresh = false) {
  if (refresh) await codexSnapshot(db, true);
  const gate = await riaProviderGate(db);
  const snapshot = await read(db, SNAPSHOT_KEY) as CodexSnapshot | undefined;
  return { ...gate, codexModel: CODEX_MODEL, codexContextWindow: CODEX_CONTEXT, codexReasoning: CODEX_REASONING,
    codex: snapshot ?? null, codexHold: (await read(db, HOLD_KEY)) ?? null };
}

export function withRiaProvider<T>(provider: RiaProvider, work: () => Promise<T>): Promise<T> { return context.run(provider, work); }
export function riaExtractorCall(db: Db): ExtractorCall {
  return async (input) => {
    const provider = context.getStore() ?? (await riaProviderGate(db)).provider;
    const started = Date.now();
    try {
      const result = await (provider === "codex" ? dockerCodexExtractorCall : dockerExtractorCall)(input);
      if (provider === "codex") {
        try {
          const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, input.runId));
          if (run) await logExtractorCall(db, run, { seq: 0, prompt: input.prompt, json: result.json,
            raw: result.raw, usage: result.usage, durationMs: Date.now() - started });
        } catch { console.error("Codex call audit logging failed; successful extraction retained"); }
      }
      return result;
    }
    catch (error) {
      if (error instanceof CodexCallError && (error.kind === "quota" || error.kind === "auth")) await markCodexHold(db, error.kind);
      throw error;
    }
  };
}
