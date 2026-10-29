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
  type McpServerConfig,
} from "./types.js";
import { AGENTS_NETWORK, AGENT_IMAGE, MUSE_MOUNT, MUSE_VOLUME } from "./setup.js";
import { MuseHandle, mcpServerConfigJson } from "./muse.js";

const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const DOCKER_STOP_TIMEOUT_S = 10;

export const RUN_LABEL = "kardata.run";
export const CONTAINER_MEMORY = "2g";
export const CONTAINER_CPUS = "2";
export const CONTAINER_PIDS_LIMIT = "512";

/**
 * Adopted Step 0 run config: lockdown (no shell/write), contributor mode on
 * (off = read-only session, proven by probe), pinned model, and the cost
 * flags (no-ops in the sterile container, insurance against future drift).
 * Presets and Playwright subsets were measured and NOT adopted (see review).
 */
export const RESEARCH_MUSE_ARGS = [
  "--disable-shell",
  "--disable-write",
  "--contributor-mode",
  "on",
  "--model",
  "muse-spark-1.3",
  "--disable-reminders",
  "--no-foreign-personal-context",
  // Muse withholds the subagent tools in an untrusted workspace ("Agent
  // delegation: auto unavailable"), so the prompt's one-subagent-per-area
  // plan silently ran solo. /workspace is empty in the container: trusting it
  // loads no skills or rules and changes no approval or sandbox setting.
  "--trust-workspace",
];

/** Playwright MCP as proven in the container (--no-sandbox: Chrome's user
 * namespace is unavailable in Docker; the container sandbox remains). */
export const PLAYWRIGHT_SERVER_CONFIG: McpServerConfig = {
  name: "playwright",
  command: "playwright-mcp",
  args: ["--headless", "--isolated", "--no-sandbox"],
};

/**
 * Per-run Playwright config fenced to the company's origins
 * (--allowed-origins is semicolon-separated; verified in @playwright/mcp
 * 0.0.83, which warns it is not a security boundary and skips redirects).
 * An empty list keeps the unfenced base config.
 */
export function playwrightServerConfig(origins: string[]): McpServerConfig {
  if (origins.length === 0) return { ...PLAYWRIGHT_SERVER_CONFIG };
  return {
    ...PLAYWRIGHT_SERVER_CONFIG,
    args: [...(PLAYWRIGHT_SERVER_CONFIG.args ?? []), "--allowed-origins", origins.join(";")],
  };
}

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
    "--network",
    AGENTS_NETWORK,
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
  readonly containerId: string;
  private containerName: string;

  constructor(
    child: ChildProcess,
    stallTimeoutMs: number,
    containerName: string,
    opts: { terminalGraceMs?: number; onRawLine?: (line: string) => void } = {},
  ) {
    super(child, stallTimeoutMs, opts);
    // The name is deterministic and valid for every docker operation.
    this.containerId = containerName;
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
    return new DockerMuseHandle(child, opts.limits.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS, containerName, {
      terminalGraceMs: opts.limits.terminalGraceMs,
      onRawLine: opts.onRawLine,
    });
  },
};
