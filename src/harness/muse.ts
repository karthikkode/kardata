/**
 * Shared JSONL normalizer for Muse runs. Research runs use
 * `dockerMuseHarness` (docker.ts): one container per run with the app-owned
 * Muse. There is no host-binary path (the Stage 3a spike script keeps one
 * for manual dev runs only).
 * Proven in the spike (see review):
 * - per-run MCP via `-c mcpServers.<name>=<json>` (secrets as whole ${VAR});
 * - tool calls surface as task kinds + tool.result (arguments are NOT in the
 *   stream); subagent labels are NOT in the stream either (session log only);
 * - SIGTERM alone reaps the whole tree (playwright MCP + Chromium die too);
 * - hitting --max-model-steps ends run.terminal.failed + exit 1.
 */
import { type ChildProcess } from "node:child_process";
import {
  type HarnessEvent,
  type HarnessUsage,
  type HarnessWaitResult,
} from "./types.js";

const SIGKILL_AFTER_MS = 10_000;

interface JsonlEvent {
  stream?: { kind?: string; id?: string };
  payload_type?: string;
  payload?: {
    kind?: string;
    text?: string;
    terminal?: string;
    reason?: string | null;
    call_id?: string;
    correlation_facts?: { outcome?: string; tool_name?: string };
    models?: {
      model?: string;
      input_tokens?: number;
      output_tokens?: number;
      cached_tokens?: number;
      reasoning_tokens?: number;
    }[];
    calls?: number;
    event?: { kind?: string; task_kind?: string; chunk?: string; final_result?: boolean };
  };
}

export class MuseHandle {
  readonly events: AsyncIterable<HarnessEvent>;
  protected child: ChildProcess;
  private queue: HarnessEvent[] = [];
  private waiters: (() => void)[] = [];
  private ended = false;
  protected exitCode: number | null = null;
  private finalMessage = "";
  private usage: HarnessUsage | undefined;
  private lastEventAt = Date.now();
  private stallTimer: NodeJS.Timeout | null = null;
  protected stopped = false;
  private terminalAt: number | null = null;

  constructor(
    child: ChildProcess,
    stallTimeoutMs: number,
    opts: { terminalGraceMs?: number; onRawLine?: (line: string) => void } = {},
  ) {
    this.child = child;
    const graceMs = opts.terminalGraceMs ?? 60_000;
    const onRawLine = opts.onRawLine;
    let buf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === "") continue;
        if (onRawLine) {
          try {
            onRawLine(line);
          } catch {
            /* the tee must never break the run */
          }
        }
        this.onLine(line);
      }
    });
    child.on("error", () => this.push({ type: "error", message: "spawn failed" }));
    child.on("close", (code) => {
      this.exitCode = code ?? 0;
      this.finish();
    });
    this.stallTimer = setInterval(() => {
      if (this.ended) return;
      const windowMs = this.terminalAt !== null ? graceMs : stallTimeoutMs;
      if (Date.now() - this.lastEventAt > windowMs) {
        this.push({ type: "error", message: `no events for ${windowMs}ms (stall)` });
        void this.stop("stall");
      }
    }, Math.min(10_000, Math.max(1000, Math.floor(Math.min(stallTimeoutMs, graceMs) / 6))));
    this.stallTimer.unref?.();
    this.events = {
      [Symbol.asyncIterator]: () => this.iterate(),
    };
  }

  private push(event: HarnessEvent): void {
    if (this.ended) return;
    this.lastEventAt = Date.now();
    this.queue.push(event);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  private async *iterate(): AsyncGenerator<HarnessEvent> {
    while (!this.ended || this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private onLine(line: string): void {
    let parsed: JsonlEvent;
    try {
      parsed = JSON.parse(line) as JsonlEvent;
    } catch {
      return;
    }
    const payload = parsed.payload ?? {};
    switch (parsed.payload_type) {
      case "session.run.linked":
        this.push({ type: "started", sessionId: parsed.stream?.id ?? "" });
        break;
      case "task.lifecycle.proposed": {
        const kind = payload.event?.task_kind ?? "";
        if (kind.startsWith("tool.")) {
          const name = kind.slice("tool.".length);
          this.push({ type: "tool_call", name });
          if (name === "workflow") this.push({ type: "subagent", phase: "launched" });
        }
        break;
      }
      case "tool.result":
        this.push({
          type: "tool_result",
          name: payload.correlation_facts?.tool_name ?? "",
          outcome: payload.correlation_facts?.outcome ?? "",
          text: payload.text ?? "",
        });
        break;
      case "run.output.delta":
        if (payload.text) this.push({ type: "message", text: payload.text });
        break;
      case "run.usage": {
        const model = payload.models?.[0];
        this.usage = {
          model: model?.model,
          inputTokens: model?.input_tokens ?? 0,
          outputTokens: model?.output_tokens ?? 0,
          cachedTokens: model?.cached_tokens ?? 0,
          reasoningTokens: model?.reasoning_tokens ?? 0,
          calls: payload.calls ?? 0,
        };
        this.push({ type: "usage", ...this.usage });
        break;
      }
      case "run.terminal.completed":
        this.finalMessage = payload.text ?? "";
        this.terminalAt ??= Date.now();
        this.push({
          type: "finished",
          terminal: "completed",
          text: payload.text ?? "",
        });
        break;
      case "run.terminal.failed":
        this.finalMessage = payload.text ?? "";
        this.terminalAt ??= Date.now();
        if (payload.reason) this.push({ type: "error", message: payload.reason });
        this.push({
          type: "finished",
          terminal: "failed",
          reason: payload.reason ?? undefined,
          text: payload.text ?? "",
        });
        break;
      default:
        break;
    }
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.stallTimer) clearInterval(this.stallTimer);
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async stop(reason: string): Promise<void> {
    void reason;
    if (this.stopped || this.exitCode !== null) return;
    this.stopped = true;
    this.child.kill("SIGTERM");
    // Unref'd: the escalation wait must never hold the process open.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, SIGKILL_AFTER_MS);
      timer.unref?.();
    });
    if (this.exitCode === null) {
      try {
        this.child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }

  async wait(): Promise<HarnessWaitResult> {
    while (this.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Queued events stay for the consumer's own iteration; usage and the
    // final message were captured synchronously as the stream arrived.
    return { exitCode: this.exitCode, finalMessage: this.finalMessage, usage: this.usage };
  }
}

export function mcpServerConfigJson(server: {
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
}): string {
  if (server.url) {
    return JSON.stringify({ url: server.url, ...(server.headers ? { headers: server.headers } : {}) });
  }
  return JSON.stringify({ command: server.command, args: server.args ?? [] });
}


