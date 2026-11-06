import { AsyncLocalStorage } from "node:async_hooks";
import { AGENTS_NETWORK } from "./setup.js";
import { CONTAINER_CPUS, CONTAINER_MEMORY, CONTAINER_PIDS_LIMIT, RUN_LABEL } from "./docker.js";
import { CODEX_MODEL, CODEX_CONTEXT, CODEX_REASONING } from "./codex-model.js";
export { CODEX_MODEL, CODEX_CONTEXT, CODEX_REASONING } from "./codex-model.js";

export const CODEX_IMAGE = "kardata-codex-agent";
export const CODEX_VOLUME = "kardata_codex";
export const CODEX_MOUNT = "/opt/codex";
export const CODEX_AUTH_ARGS = ["-c", 'cli_auth_credentials_store="file"'];
const reasoningContext = new AsyncLocalStorage<"medium" | "high">();

/** Per-call effort; concurrent ordinary reads retain the configured default. */
export function withCodexReasoning<T>(effort: "medium" | "high", work: () => Promise<T>): Promise<T> {
  return reasoningContext.run(effort, work);
}

export function codexContainerName(runId: string, area: string): string {
  return `kardata-codex-${`${runId}-${area}`.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100)}`;
}

/** Only the app-owned Codex volume is mounted; no personal auth or Muse volume. */
export function codexBaseArgs(): string[] {
  return ["run", "--rm", "-i", "--read-only", "--tmpfs", "/tmp", "--tmpfs", "/workspace",
    "--network", AGENTS_NETWORK, "-v", `${CODEX_VOLUME}:${CODEX_MOUNT}`,
    "-e", `CODEX_HOME=${CODEX_MOUNT}/home`, "-e", "HOME=/workspace", "-e", "LANG=C.UTF-8"];
}

export function codexExtractArgs(input: { runId: string; area: string; inputDir: string }): string[] {
  if (!input.inputDir) throw new Error("Codex extraction requires an input directory");
  return [...codexBaseArgs(), "--name", codexContainerName(input.runId, input.area),
    "--label", `${RUN_LABEL}=${input.runId}`, "--memory", CONTAINER_MEMORY,
    "--cpus", CONTAINER_CPUS, "--pids-limit", CONTAINER_PIDS_LIMIT,
    "--mount", `type=bind,src=${input.inputDir},dst=/input,ro`, CODEX_IMAGE,
    ...CODEX_AUTH_ARGS, "exec", "--json", "--ephemeral", "--skip-git-repo-check",
    "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
    "--disable", "shell_tool", "--disable", "multi_agent", "--disable", "hooks", "--disable", "plugins",
    "-c", 'web_search="disabled"', "-c", "mcp_servers={}", "-c", 'approval_policy="never"',
    "--model", CODEX_MODEL, "-c", `model_context_window=${CODEX_CONTEXT}`,
    "-c", `model_reasoning_effort="${reasoningContext.getStore() ?? CODEX_REASONING}"`, "-c", 'forced_login_method="chatgpt"',
    "--output-schema", "/input/schema.json", "-"];
}
