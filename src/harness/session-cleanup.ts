import { execFile, spawnSync } from "node:child_process";
import { AGENT_IMAGE, MUSE_MOUNT, MUSE_VOLUME } from "./setup.js";

/**
 * Muse session cleanup for the kardata_muse volume: every agent,
 * extractor and classifier container uses the volume as HOME, and Muse
 * session logs (.local/share/muse/sessions) are never removed, so the
 * volume grows without bound. After each run (and after usage/ingest
 * have read the logs), delete that run's session dirs; a prune pass
 * removes leftovers from crashed runs. The install (bin/) and
 * .config/muse/auth.json are never touched — harness/session-cleanup.mjs
 * enforces that by construction (it only deletes inside the sessions
 * root and the home cache dir).
 */

const SESSIONS_ROOT = `${MUSE_MOUNT}/home/.local/share/muse/sessions`;
const HOME_DIR = `${MUSE_MOUNT}/home`;
const CLEANUP_SCRIPT = "/usr/local/bin/session-cleanup.mjs";

function baseArgs(): string[] {
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    "-v",
    `${MUSE_VOLUME}:${MUSE_MOUNT}`,
    "-e",
    `HOME=${HOME_DIR}`,
    AGENT_IMAGE,
    CLEANUP_SCRIPT,
  ];
}

export function sessionCleanupRunArgs(sessionIds: string[]): string[] {
  return [...baseArgs(), "sessions", SESSIONS_ROOT, ...sessionIds];
}

export function sessionPruneRunArgs(maxAgeDays = 1): string[] {
  return [...baseArgs(), "prune", SESSIONS_ROOT, HOME_DIR, String(maxAgeDays)];
}

export function volumeStatRunArgs(): string[] {
  return [...baseArgs(), "stat", MUSE_MOUNT];
}

export interface CleanupSummary {
  ok: boolean;
  deleted: number;
  bytesFreed: number;
  note?: string;
}

type DockerCall = (args: string[]) => Promise<{ ok: boolean; stdout: string }>;

function defaultDockerCall(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve({ ok: !err, stdout: typeof stdout === "string" ? stdout : "" });
    });
  });
}

async function runCleanup(args: string[], call: DockerCall): Promise<CleanupSummary> {
  try {
    const out = await call(args);
    if (!out.ok) return { ok: false, deleted: 0, bytesFreed: 0, note: "cleanup container failed" };
    const parsed = JSON.parse(out.stdout) as { deleted?: unknown; bytesFreed?: unknown };
    return {
      ok: true,
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted.length : typeof parsed.deleted === "number" ? parsed.deleted : 0,
      bytesFreed: typeof parsed.bytesFreed === "number" ? parsed.bytesFreed : 0,
    };
  } catch (err) {
    return { ok: false, deleted: 0, bytesFreed: 0, note: err instanceof Error ? err.message : "cleanup failed" };
  }
}

/** Delete one run's session dirs. Never throws; safe to fire and forget. */
export async function cleanupRunSessions(sessionIds: (string | undefined)[], call: DockerCall = defaultDockerCall): Promise<CleanupSummary> {
  const ids = [...new Set(sessionIds.filter((s): s is string => typeof s === "string" && s !== ""))];
  if (ids.length === 0) return { ok: true, deleted: 0, bytesFreed: 0, note: "no session id" };
  return runCleanup(sessionCleanupRunArgs(ids), call);
}

/** Prune leftover session/cache files older than maxAgeDays. Never throws. */
export async function pruneOldSessions(maxAgeDays = 1, call: DockerCall = defaultDockerCall): Promise<CleanupSummary> {
  return runCleanup(sessionPruneRunArgs(maxAgeDays), call);
}

/** Volume used bytes via the cleanup script's stat mode; null when unavailable. */
export function probeMuseVolumeBytes(callSync: (args: string[]) => { ok: boolean; stdout: string } = (args) => {
  try {
    const result = spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
    return { ok: !result.error && result.status === 0, stdout: result.stdout ?? "" };
  } catch {
    return { ok: false, stdout: "" };
  }
}): number | null {
  const out = callSync(volumeStatRunArgs());
  if (!out.ok) return null;
  try {
    const parsed = JSON.parse(out.stdout) as { volumeUsedBytes?: unknown };
    return typeof parsed.volumeUsedBytes === "number" ? parsed.volumeUsedBytes : null;
  } catch {
    return null;
  }
}
