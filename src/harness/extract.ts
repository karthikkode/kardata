/**
 * One-shot extraction containers (Stage 4.1 Step 1): tool-less headless Muse
 * calls with --output-schema. Unlike research runs these carry no MCP servers
 * and no auth token; the prompt and schema enter through a read-only bind
 * mount of a server-written input dir (deleted after the call).
 *
 * Invariants (asserted in tests/harness/extract.test.ts):
 * - no KARDATA_MCP_AUTH or any other secret env;
 * - the only mounts are the kardata_muse volume and the :ro input dir;
 * - read-only root FS with tmpfs /tmp and /workspace;
 * - label kardata.run=<runId> for stop and boot recovery.
 */
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENTS_NETWORK, AGENT_IMAGE, MUSE_MOUNT, MUSE_VOLUME } from "./setup.js";
import { CONTAINER_CPUS, CONTAINER_MEMORY, CONTAINER_PIDS_LIMIT, RUN_LABEL } from "./docker.js";

export const EXTRACT_INPUT_MOUNT = "/input";
export const EXTRACT_PROMPT_FILE = "prompt.md";
export const EXTRACT_SCHEMA_FILE = "schema.json";

/** Tool-less lockdown plus the pinned model; no MCP servers are configured. */
export const EXTRACT_MUSE_ARGS = [
  "--disable-web-tools",
  "--disable-shell",
  "--disable-write",
  "--model",
  "muse-spark-1.3",
  "--disable-reminders",
  "--no-foreign-personal-context",
  "--max-model-steps",
  "3",
  // Same as RESEARCH_MUSE_ARGS: muse refuses to run in an untrusted
  // workspace ("Agent delegation: auto unavailable"), which exits 1.
  // /workspace is an empty tmpfs in the container.
  "--trust-workspace",
];

export function extractContainerName(runId: string, area: string): string {
  const safe = `${runId}-${area}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100);
  if (safe.replace(/-/g, "") === "") throw new Error("runId has no usable characters for a container name");
  return `kardata-extract-${safe}`;
}

export interface ExtractRunOptions {
  runId: string;
  area: string;
  inputDir: string;
}

/** Exact `docker run` argv for one extraction call. Refuses a missing input dir. */
export function extractRunArgs(opts: ExtractRunOptions): string[] {
  if (!opts.inputDir) throw new Error("extraction runs require an input dir");
  return [
    "run",
    "--rm",
    "--name",
    extractContainerName(opts.runId, opts.area),
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
    `type=bind,src=${opts.inputDir},dst=${EXTRACT_INPUT_MOUNT},ro`,
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
    ...EXTRACT_MUSE_ARGS,
    "--output-schema",
    `${EXTRACT_INPUT_MOUNT}/${EXTRACT_SCHEMA_FILE}`,
    "--prompt-file",
    `${EXTRACT_INPUT_MOUNT}/${EXTRACT_PROMPT_FILE}`,
  ];
}

export interface ExtractInput {
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Write prompt.md + schema.json to a fresh tmpdir; the caller must cleanup.
 * The container runs as a non-root user, so the dir and files are made
 * world-readable (they hold research notes, never secrets).
 */
export async function prepareExtractInput(prompt: string, schema: string): Promise<ExtractInput> {
  const dir = await mkdtemp(join(tmpdir(), "kardata-extract-"));
  await writeFile(join(dir, EXTRACT_PROMPT_FILE), prompt, "utf8");
  await writeFile(join(dir, EXTRACT_SCHEMA_FILE), schema, "utf8");
  await chmod(join(dir, EXTRACT_PROMPT_FILE), 0o644);
  await chmod(join(dir, EXTRACT_SCHEMA_FILE), 0o644);
  await chmod(dir, 0o755);
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }).then(() => undefined),
  };
}
