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
  /** Kill the run after this long without any event (Q9 stall finding). */
  stallTimeoutMs?: number;
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
      calls: number;
    }
  | { type: "error"; message: string }
  | { type: "finished"; terminal: string; reason?: string; text: string };

export interface HarnessUsage {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
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
}

export interface AgentHarness {
  start(opts: HarnessStartOptions): HarnessHandle;
}
