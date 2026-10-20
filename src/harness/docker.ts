/**
 * Docker harness for research runs (Stage 3b Step 0): one `kardata-agent`
 * container per run with the app-owned Muse. The container's stdout is the
 * same JSONL stream, so events reuse `MuseHandle`; only start/stop differ.
 *
 * Invariants (asserted in tests/harness/docker.test.ts):
 * - env allowlist: exactly KARDATA_MCP_AUTH, HOME, MUSE_NO_AUTO_UPDATE, LANG;
 * - the only mount is the kardata_muse volume — never anything under a home;
 * - read-only root FS with tmpfs /tmp and /workspace;
 * - label kardata.run=<runId> for stop and boot recovery.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  type AgentHarness,
  type HarnessStartOptions,
} from "./types.js";
import { AGENT_IMAGE, MUSE_MOUNT, MUSE_VOLUME } from "./setup.js";
import { MuseHandle, mcpServerConfigJson } from "./muse.js";

const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const DOCKER_STOP_TIMEOUT_S = 10;

export const RUN_LABEL = "kardata.run";
export const CONTAINER_MEMORY = "2g";
export const CONTAINER_CPUS = "2";
export const CONTAINER_PIDS_LIMIT = "512";

/** docker --name value: sanitized, because it derives from the run id. */
export function containerNameForRun(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
  if (safe === "") throw new Error("runId has no usable characters for a container name");
  return `kardata-run-${safe}`;
}

function museArgs(opts: HarnessStartOptions): string[] {
  return [
    "exec",
    "--json",
    "--max-model-steps",
    String(opts.limits.maxModelSteps),
    ...opts.mcpServers.flatMap((s) => ["-c", `mcpServers.${s.name}=${mcpServerConfigJson(s)}`]),
    ...(opts.extraArgs ?? []),
    opts.prompt,
  ];
}

/**
 * Exact `docker run` argv. Throws when opts.env carries anything outside the
 * allowlist (fail closed: no host secret may leak into the container).
 */
export function dockerRunArgs(opts: HarnessStartOptions): string[] {
  const auth = opts.env["KARDATA_MCP_AUTH"];
  if (!auth) throw new Error("docker runs require opts.env.KARDATA_MCP_AUTH");
  const extra = Object.keys(opts.env).filter((k) => k !== "KARDATA_MCP_AUTH");
  if (extra.length > 0) throw new Error(`docker runs refuse extra env: ${extra.join(",")}`);
  return [
    "run",
    "--rm",
    "--name",
    containerNameForRun(opts.runId),
    "--label",
    `${RUN_LABEL}=${opts.runId}`,
    "--memory",
    CONTAINER_MEMORY,
    "--cpus",
    CONTAINER_CPUS,
    "--pids-limit",
    CONTAINER_PIDS_LIMIT,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/workspace",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-v",
    `${MUSE_VOLUME}:${MUSE_MOUNT}`,
    "-e",
    `KARDATA_MCP_AUTH=${auth}`,
    "-e",
    `HOME=${MUSE_MOUNT}/home`,
    "-e",
    "MUSE_NO_AUTO_UPDATE=1",
    "-e",
    "LANG=C.UTF-8",
    AGENT_IMAGE,
    "run",
    ...museArgs(opts),
  ];
}

export function dockerStopArgs(containerName: string): string[] {
  return ["stop", "-t", String(DOCKER_STOP_TIMEOUT_S), containerName];
}

export function recoveryListArgs(): string[] {
  return ["ps", "-q", "--filter", `label=${RUN_LABEL}`];
}

function runDocker(args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout });
    });
  });
}

/**
 * Boot recovery: stop every container started by a previous server lifetime.
 * Returns the stopped container ids (best effort per container).
 */
export async function recoverLabeledContainers(): Promise<string[]> {
  let list: { stdout: string };
  try {
    list = await runDocker(recoveryListArgs());
  } catch {
    return [];
  }
  const ids = list.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const stopped: string[] = [];
  for (const id of ids) {
    try {
      await runDocker(dockerStopArgs(id));
      stopped.push(id);
    } catch {
      /* already gone; the next boot lists nothing */
    }
  }
  return stopped;
}

class DockerMuseHandle extends MuseHandle {
  private containerName: string;

  constructor(child: ChildProcess, stallTimeoutMs: number, containerName: string) {
    super(child, stallTimeoutMs);
    this.containerName = containerName;
  }

  override async stop(reason: string): Promise<void> {
    void reason;
    if (this.stopped || this.exitCode !== null) return;
    this.stopped = true;
    // SIGTERM inside the container, SIGKILL after the timeout; the local
    // `docker run` CLI exits once the container is gone.
    try {
      await runDocker(dockerStopArgs(this.containerName));
    } catch {
      /* already exited */
    }
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export const dockerMuseHarness: AgentHarness = {
  start(opts: HarnessStartOptions): DockerMuseHandle {
    const containerName = containerNameForRun(opts.runId);
    const child = spawn("docker", dockerRunArgs(opts), { stdio: ["ignore", "pipe", "pipe"] });
    child.stderr?.on("data", () => {});
    return new DockerMuseHandle(
      child,
      opts.limits.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
      containerName,
    );
  },
};
