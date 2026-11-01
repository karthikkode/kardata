/**
 * Prune leftover Muse session/cache files in the kardata_muse volume
 * (npm run harness:prune): deletes session dirs and cache entries older
 * than a day — leftovers from crashed runs. Per-run cleanup already
 * removes each finished run's sessions; this is the backstop. Prints
 * the volume size before and after. Never touches the Muse install
 * or .config/muse/auth.json.
 */
import { spawnSync } from "node:child_process";
import { sessionPruneRunArgs, volumeStatRunArgs } from "../src/harness/session-cleanup.js";

function runDocker(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 180_000 });
  if (result.error) {
    console.error(`cannot run docker: ${(result.error as Error).message}`);
    process.exit(2);
  }
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

function volumeBytes(): number | null {
  const out = runDocker(volumeStatRunArgs());
  if (!out.ok) return null;
  try {
    const parsed = JSON.parse(out.stdout) as { volumeUsedBytes?: unknown };
    return typeof parsed.volumeUsedBytes === "number" ? parsed.volumeUsedBytes : null;
  } catch {
    return null;
  }
}

function mb(bytes: number | null): string {
  return bytes === null ? "unknown" : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function main(): void {
  const days = Number(process.argv[2] ?? "1");
  const before = volumeBytes();
  console.log(`kardata_muse volume before prune: ${mb(before)}`);
  const out = runDocker(sessionPruneRunArgs(Number.isFinite(days) && days >= 0 ? days : 1));
  if (!out.ok) {
    console.error("prune container failed");
    process.exit(1);
  }
  console.log(out.stdout.trim());
  const after = volumeBytes();
  console.log(`kardata_muse volume after prune: ${mb(after)}`);
}

main();
