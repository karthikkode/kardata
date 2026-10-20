/**
 * App-owned Muse setup (Stage 3b Step 0). Pure docker-invocation builders for
 * `npm run harness:setup`; the thin runner lives in scripts/harness-setup.ts.
 * Research-run containers (DockerMuseHarness) reuse AGENT_IMAGE/MUSE_VOLUME.
 */
import { spawnSync } from "node:child_process";

export const AGENT_IMAGE = "kardata-agent";
export const MUSE_VOLUME = "kardata_muse";
export const MUSE_MOUNT = "/opt/muse";
export const AGENT_UID = 10001;
export const LAUNCHER_URL = "https://api.meta.ai/muse-launcher.sh";
// Dedicated agent network (Stage 3b.1): fixed subnet so the gateway IP is
// stable. The server listens on 127.0.0.1 and the gateway; containers reach
// MCP at the gateway. Never 0.0.0.0.
export const AGENTS_NETWORK = "kardata_agents";
export const AGENTS_SUBNET = "172.31.250.0/24";
export const AGENTS_GATEWAY = "172.31.250.1";

export function dockerBuildArgs(harnessDir: string): string[] {
  return ["build", "-t", AGENT_IMAGE, harnessDir];
}

export function volumeCreateArgs(): string[] {
  return ["volume", "create", MUSE_VOLUME];
}

export function networkInspectArgs(): string[] {
  return ["network", "inspect", AGENTS_NETWORK];
}

export function networkCreateArgs(): string[] {
  return ["network", "create", "--subnet", AGENTS_SUBNET, AGENTS_NETWORK];
}

// Usage-reader: one shot, no network (volume read only).
export function readerRunArgs(sessionId: string): string[] {
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    "-v",
    `${MUSE_VOLUME}:${MUSE_MOUNT}:ro`,
    "-e",
    `HOME=${MUSE_MOUNT}/home`,
    AGENT_IMAGE,
    "/usr/local/bin/usage-reader.mjs",
    sessionId,
  ];
}

// Interactive setup container (the owner runs it): root so it can install the
// launcher and chown the volume to the agent user; the named volume only —
// never anything under the owner's home.
export function setupRunArgs(): string[] {
  return [
    "run",
    "--rm",
    "-it",
    "--user",
    "root",
    "-v",
    `${MUSE_VOLUME}:${MUSE_MOUNT}`,
    "-e",
    "MUSE_NO_AUTO_UPDATE=1",
    "-e",
    `HOME=${MUSE_MOUNT}/home`,
    "-e",
    "LANG=C.UTF-8",
    AGENT_IMAGE,
    "setup",
  ];
}

// Version probe (read-only mount): what the setup stores as
// KARDATA_MUSE_VERSION, and what kardata-server checks at boot.
export function versionRunArgs(): string[] {
  return ["run", "--rm", "-v", `${MUSE_VOLUME}:${MUSE_MOUNT}:ro`, AGENT_IMAGE, "version"];
}

// Exactly one non-empty stdout line, charset-checked. `muse --version` prints
// `Muse Code 1.4.11 (1.4.11-R6667.1)`; the parenthesized build is the precise
// pin. Null when the output doesn't match (caller prints it for manual
// handling instead of writing a suspicious value into .env).
export function parseMuseVersion(output: string): string | null {
  const lines = output
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (lines.length !== 1) return null;
  const line = lines[0];
  const branded = /^muse(?: code)? \S+ \(([0-9A-Za-z._+-]+)\)$/i.exec(line);
  if (branded) return branded[1];
  if (!/^[0-9A-Za-z._+-]+$/.test(line)) return null;
  return line;
}

export interface AppMuseVersion {
  /** True only when the installed build equals the expected pin. */
  ok: boolean;
  installed: string | null;
  expected: string | null;
}

/**
 * Compare the app Muse build installed in the volume against the
 * KARDATA_MUSE_VERSION pin. The runner injects stdout in tests; production
 * passes the `docker run ... version` probe output.
 */
export function checkAppMuseVersion(expected: string | undefined, probeStdout: string): AppMuseVersion {
  const want = expected?.trim() ? expected.trim() : null;
  const installed = parseMuseVersion(probeStdout);
  return { ok: installed !== null && installed === want, installed, expected: want };
}

/** Run the read-only version probe; "" when docker or the volume is missing. */
export function probeInstalledMuseVersion(): string {
  try {
    const result = spawnSync("docker", versionRunArgs(), { encoding: "utf8", timeout: 60_000 });
    if (result.error || result.status !== 0) return "";
    return result.stdout ?? "";
  } catch {
    return "";
  }
}

export function applyDotenvVersion(existing: string, version: string): string {
  const line = `KARDATA_MUSE_VERSION=${version}`;
  if (/^KARDATA_MUSE_VERSION=.*$/m.test(existing)) {
    return existing.replace(/^KARDATA_MUSE_VERSION=.*$/m, line);
  }
  const withNewline = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${withNewline}${line}\n`;
}
