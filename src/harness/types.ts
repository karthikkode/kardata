/**
 * Agent-harness interface for Stage 3b. The orchestrator talks only to this;
 * another harness (a different agent CLI) can replace `muse.ts` later.
 */

export interface McpServerConfig {
  name: string;
  /** Streamable-HTTP endpoint (exactly one of url/command). */
  url?: string;
  headers?: Record<string, string>;
  /** Stdio command. */
  command?: string;
  args?: string[];
}

export interface HarnessLimits {
  maxModelSteps: number;
  /**
   * Kill the run after this long without any event (Q9 stall finding).
   * 0 disables the timer: the agent runner passes 0 because it owns liveness
   * (stdout events plus MCP calls, which the harness cannot see).
   */
  stallTimeoutMs?: number;
  /**
   * After the first terminal event, shrink the stall window to this: the run
   * is done and lingering (completion arrives as a second run; the gap is
   * ~20 s when healthy). Default 60 s.
   */
  terminalGraceMs?: number;
}

export interface HarnessStartOptions {
  runId: string;
  workspaceDir: string;
  prompt: string;
  mcpServers: McpServerConfig[];
  env: Record<string, string>;
  limits: HarnessLimits;
  /** Extra CLI args (e.g. lockdown flags). */
  extraArgs?: string[];
  /** Raw stdout lines, e.g. for the runner's events.jsonl. Never throws. */
  onRawLine?: (line: string) => void;
}

export type HarnessEvent =
  | { type: "started"; sessionId: string }
  | { type: "tool_call"; name: string; callId?: string }
  | { type: "tool_result"; name: string; outcome: string; text: string }
  | { type: "message"; text: string }
  | { type: "subagent"; phase: "launched"; entryId?: string }
  | {
      type: "usage";
      model?: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      reasoningTokens: number;
      calls: number;
    }
  | { type: "error"; message: string }
  | { type: "finished"; terminal: string; reason?: string; text: string };

export interface HarnessUsage {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  calls: number;
}

export interface HarnessWaitResult {
  exitCode: number;
  finalMessage: string;
  usage?: HarnessUsage;
}

export interface HarnessHandle {
  events: AsyncIterable<HarnessEvent>;
  stop(reason: string): Promise<void>;
  wait(): Promise<HarnessWaitResult>;
  /** Container name/id when the harness runs in Docker. */
  containerId?: string;
}

export interface AgentHarness {
  start(opts: HarnessStartOptions): HarnessHandle;
}
