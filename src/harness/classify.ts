/**
 * One-shot sector-preflight classifier containers (Stage 5.1 Step 1):
 * tool-less headless Muse calls with --output-schema. Mirrors the extractor
 * lockdown: no MCP servers, no auth token, no secrets in env; the prompt and
 * schema enter through a read-only bind mount of a server-written input dir
 * (deleted after the call); read-only root FS with tmpfs /tmp and /workspace;
 * label kardata.run=<runId> for stop and boot recovery.
 */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS_NETWORK, AGENT_IMAGE, MUSE_MOUNT, MUSE_VOLUME } from "./setup.js";
import { CONTAINER_CPUS, CONTAINER_MEMORY, CONTAINER_PIDS_LIMIT, RUN_LABEL } from "./docker.js";

export const CLASSIFY_INPUT_MOUNT = "/input";
export const CLASSIFY_PROMPT_FILE = "prompt.md";
export const CLASSIFY_SCHEMA_FILE = "schema.json";

/**
 * Tool-less lockdown plus the pinned model, contributor mode and medium
 * effort (owner's run config; Muse defaults to high); no MCP servers are
 * configured.
 */
export const CLASSIFY_MUSE_ARGS = [
  "--disable-web-tools",
  "--disable-shell",
  "--disable-write",
  "--contributor-mode",
  "on",
  "--model",
  "muse-spark-1.3",
  "--reasoning-effort",
  "medium",
  "--disable-reminders",
  "--no-foreign-personal-context",
  "--max-model-steps",
  "3",
  // Muse refuses to run in an untrusted workspace (see extract.ts).
  "--trust-workspace",
];

/**
 * Web fallback (our server could not read the site): same lockdown, but
 * Muse's own web tools (web_fetch, web_search) stay on and the step cap
 * leaves room to read a few pages. Still no shell, write or MCP servers.
 */
export const CLASSIFY_WEB_MAX_STEPS = "10";
export const CLASSIFY_WEB_MUSE_ARGS = CLASSIFY_MUSE_ARGS.filter((arg) => arg !== "--disable-web-tools").map(
  (arg, i, all) => (all[i - 1] === "--max-model-steps" ? CLASSIFY_WEB_MAX_STEPS : arg),
);

/** Container name per call; `callKey` separates parallel calls of one run (ICP votes). */
export function classifyContainerName(runId: string, callKey?: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
  if (safe.replace(/-/g, "") === "") throw new Error("runId has no usable characters for a container name");
  const key = callKey ? `-${callKey.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 20)}` : "";
  return `kardata-classify-${safe}${key}`;
}

export interface ClassifyRunOptions {
  runId: string;
  inputDir: string;
  /** Distinct per parallel call of one run (see classifyContainerName). */
  callKey?: string;
  /** Let Muse read the site itself (our fetch got nothing). */
  web?: boolean;
}

/** Exact `docker run` argv for one classifier call. Refuses a missing input dir. */
export function classifyRunArgs(opts: ClassifyRunOptions): string[] {
  if (!opts.inputDir) throw new Error("classifier runs require an input dir");
  return [
    "run",
    "--rm",
    "--name",
    classifyContainerName(opts.runId, opts.callKey),
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
    "--mount",
    `type=bind,src=${opts.inputDir},dst=${CLASSIFY_INPUT_MOUNT},ro`,
    "-e",
    `HOME=${MUSE_MOUNT}/home`,
    "-e",
    "MUSE_NO_AUTO_UPDATE=1",
    "-e",
    "LANG=C.UTF-8",
    AGENT_IMAGE,
    "run",
    "exec",
    "--json",
    ...(opts.web ? CLASSIFY_WEB_MUSE_ARGS : CLASSIFY_MUSE_ARGS),
    "--output-schema",
    `${CLASSIFY_INPUT_MOUNT}/${CLASSIFY_SCHEMA_FILE}`,
    "--prompt-file",
    `${CLASSIFY_INPUT_MOUNT}/${CLASSIFY_PROMPT_FILE}`,
  ];
}

export interface ClassifyInput {
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Write prompt.md + schema.json to a fresh tmpdir; the caller must cleanup.
 * The container runs as a non-root user, so the dir and files are made
 * world-readable (they hold fetched pages, never secrets).
 */
export async function prepareClassifyInput(prompt: string, schema: string): Promise<ClassifyInput> {
  const dir = await mkdtemp(join(tmpdir(), "kardata-classify-"));
  await writeFile(join(dir, CLASSIFY_PROMPT_FILE), prompt, "utf8");
  await writeFile(join(dir, CLASSIFY_SCHEMA_FILE), schema, "utf8");
  await chmod(join(dir, CLASSIFY_PROMPT_FILE), 0o644);
  await chmod(join(dir, CLASSIFY_SCHEMA_FILE), 0o644);
  await chmod(dir, 0o755);
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }).then(() => undefined),
  };
}
