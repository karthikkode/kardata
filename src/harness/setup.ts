/**
 * App-owned Muse setup (Stage 3b Step 0). Pure docker-invocation builders for
 * `npm run harness:setup`; the thin runner lives in scripts/harness-setup.ts.
 * Research-run containers (DockerMuseHarness) reuse AGENT_IMAGE/MUSE_VOLUME.
 */

export const AGENT_IMAGE = "kardata-agent";
export const MUSE_VOLUME = "kardata_muse";
export const MUSE_MOUNT = "/opt/muse";
export const AGENT_UID = 10001;
export const LAUNCHER_URL = "https://api.meta.ai/muse-launcher.sh";

export function dockerBuildArgs(harnessDir: string): string[] {
  return ["build", "-t", AGENT_IMAGE, harnessDir];
}

export function volumeCreateArgs(): string[] {
  return ["volume", "create", MUSE_VOLUME];
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

// First non-empty stdout line, charset-checked. Null when the output doesn't
// look like a bare version (caller prints it for manual handling instead of
// writing a suspicious value into .env).
export function parseMuseVersion(output: string): string | null {
  const line = output
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s !== "");
  if (!line || !/^[0-9A-Za-z._+-]+$/.test(line)) return null;
  return line;
}

export function applyDotenvVersion(existing: string, version: string): string {
  const line = `KARDATA_MUSE_VERSION=${version}`;
  if (/^KARDATA_MUSE_VERSION=.*$/m.test(existing)) {
    return existing.replace(/^KARDATA_MUSE_VERSION=.*$/m, line);
  }
  const withNewline = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${withNewline}${line}\n`;
}
