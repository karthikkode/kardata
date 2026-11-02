import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtractorCall, ExtractorCallResult } from "../runs/extract.js";
import { prepareExtractInput } from "./extract.js";
import { CODEX_MODEL, codexContainerName, codexExtractArgs } from "./codex-config.js";
import type { HarnessUsage } from "./types.js";

export class CodexCallError extends Error {
  constructor(readonly kind: "quota" | "auth" | "execution", readonly diagnostic = "provider") { super(`Codex extraction ${kind === "quota" ? "usage exhausted" : kind === "auth" ? "requires login" : "failed"} (${diagnostic})`); }
}
function failureKind(text: string): "quota" | "auth" | "execution" {
  if (/usage limit|quota exceeded|insufficient_quota|usage_limit_reached/i.test(text)) return "quota";
  if (/not logged in|unauthorized|authentication|login required|refresh.*token|sign in|401\b/i.test(text)) return "auth";
  return "execution";
}

/** Static classifications only: never expose provider messages, URLs or credentials. */
function providerError(text: string): CodexCallError {
  const diagnostic = /429|rate.limit|too many requests/i.test(text) ? "rate_limited"
    : /stream|websocket|reconnect|connection|transport/i.test(text) ? "transport"
    : /schema|structured.output/i.test(text) ? "schema"
    : /context.*(?:length|limit)|too many tokens/i.test(text) ? "context_limit"
    : /memory|resource|database.*locked|read.only/i.test(text) ? "resource" : "provider";
  return new CodexCallError(failureKind(text), diagnostic);
}

/** Parse Codex JSONL; tool execution is never accepted as an extraction response. */
export class CodexExtractionOutput {
  finalMessage = "";
  usage: HarnessUsage | undefined;
  completed = false;
  lastProviderError: CodexCallError | undefined;
  accept(line: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new CodexCallError("execution", "invalid_event"); }
    const event = parsed as { type?: string; item?: { type?: string; text?: string; message?: string }; usage?: Record<string, number>; error?: { message?: string }; message?: string };
    // Exec emits reconnect/transport notices as error events, and warnings as
    // error items, while the turn is still running. Only terminal failure or
    // nonzero exit is fatal; the CLI owns its bounded transport recovery.
    if (event.type === "error" || event.item?.type === "error") {
      this.lastProviderError = providerError(event.error?.message ?? event.message ?? event.item?.message ?? "");
      return;
    }
    if (event.type === "turn.failed") throw providerError(event.error?.message ?? event.message ?? "");
    if (event.item && event.item.type !== "agent_message" && event.item.type !== "reasoning") throw new CodexCallError("execution", "tool_event");
    if (event.type === "item.completed" && event.item) {
      if (event.item.type === "agent_message") this.finalMessage = event.item.text ?? "";
      else if (event.item.type !== "reasoning") throw new CodexCallError("execution", "tool_event");
    }
    if (event.type === "turn.completed") {
      const u = event.usage;
      if (!u || ![u.input_tokens, u.output_tokens, u.cached_input_tokens ?? 0].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new CodexCallError("execution", "invalid_usage");
      this.usage = { model: CODEX_MODEL, inputTokens: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)),
        cachedTokens: u.cached_input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
        reasoningTokens: u.reasoning_output_tokens ?? 0, calls: 1 };
      this.completed = true;
    }
  }
  result(): ExtractorCallResult {
    if (!this.completed || !this.finalMessage) throw this.lastProviderError ?? new CodexCallError("execution", "incomplete");
    try { return { json: JSON.parse(this.finalMessage) as unknown, usage: this.usage, raw: this.finalMessage }; }
    catch { throw new CodexCallError("execution", "invalid_output"); }
  }
}

export const dockerCodexExtractorCall: ExtractorCall = async ({ runId, area, prompt, schema }) => {
  if (!schema) throw new Error("Codex extraction requires a JSON schema");
  const input = await prepareExtractInput(prompt, schema);
  const name = codexContainerName(runId, area);
  try {
    return await new Promise<ExtractorCallResult>((resolve, reject) => {
      const child = spawn("docker", codexExtractArgs({ runId, area, inputDir: input.dir }), { stdio: ["pipe", "pipe", "pipe"] });
      const output = new CodexExtractionOutput();
      let stderr = "", failure: Error | null = null;
      const lines = createInterface({ input: child.stdout });
      const stop = () => { const p = spawn("docker", ["stop", "-t", "1", name], { stdio: "ignore" }); p.on("error", () => undefined); };
      const timer = setTimeout(() => { failure = new CodexCallError("execution", "timeout"); stop(); child.kill("SIGTERM"); }, 600000);
      child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString("utf8")).slice(-4000); });
      lines.on("line", (line) => { try { output.accept(line); } catch (error) { failure = error instanceof CodexCallError ? error : new CodexCallError("execution", "invalid_event"); stop(); } });
      child.on("error", () => { clearTimeout(timer); reject(new CodexCallError("execution", "spawn")); });
      child.on("close", (code) => {
        clearTimeout(timer); lines.close();
        if (failure || code !== 0) { reject(failure ?? output.lastProviderError ?? providerError(stderr)); return; }
        try { resolve(output.result()); } catch (error) { reject(error); }
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(prompt);
    });
  } finally { await input.cleanup(); }
};
