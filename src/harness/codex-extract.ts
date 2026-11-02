import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ExtractorCall, ExtractorCallResult } from "../runs/extract.js";
import { prepareExtractInput } from "./extract.js";
import { CODEX_MODEL, codexContainerName, codexExtractArgs } from "./codex-config.js";
import type { HarnessUsage } from "./types.js";

export class CodexCallError extends Error {
  constructor(readonly kind: "quota" | "auth" | "execution") { super(`Codex extraction ${kind === "quota" ? "usage exhausted" : kind === "auth" ? "requires login" : "failed"}`); }
}
function failureKind(text: string): "quota" | "auth" | "execution" {
  if (/usage limit|quota exceeded|insufficient_quota|usage_limit_reached/i.test(text)) return "quota";
  if (/not logged in|unauthorized|authentication|login required|refresh.*token|sign in|401\b/i.test(text)) return "auth";
  return "execution";
}

/** Parse Codex JSONL; tool execution is never accepted as an extraction response. */
export class CodexExtractionOutput {
  finalMessage = "";
  usage: HarnessUsage | undefined;
  completed = false;
  accept(line: string): void {
    const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; usage?: Record<string, number>; error?: { message?: string }; message?: string };
    if (event.type === "error" || event.type === "turn.failed") throw new CodexCallError(failureKind(event.error?.message ?? event.message ?? ""));
    if (event.item && event.item.type !== "agent_message" && event.item.type !== "reasoning") throw new CodexCallError("execution");
    if (event.type === "item.completed" && event.item) {
      if (event.item.type === "agent_message") this.finalMessage = event.item.text ?? "";
      else if (event.item.type !== "reasoning") throw new CodexCallError("execution");
    }
    if (event.type === "turn.completed") {
      const u = event.usage;
      if (!u || ![u.input_tokens, u.output_tokens, u.cached_input_tokens ?? 0].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new CodexCallError("execution");
      this.usage = { model: CODEX_MODEL, inputTokens: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)),
        cachedTokens: u.cached_input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
        reasoningTokens: u.reasoning_output_tokens ?? 0, calls: 1 };
      this.completed = true;
    }
  }
  result(): ExtractorCallResult {
    if (!this.completed || !this.finalMessage) throw new CodexCallError("execution");
    try { return { json: JSON.parse(this.finalMessage) as unknown, usage: this.usage, raw: this.finalMessage }; }
    catch { throw new CodexCallError("execution"); }
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
      const timer = setTimeout(() => { failure = new CodexCallError("execution"); stop(); child.kill("SIGTERM"); }, 600000);
      child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString("utf8")).slice(-4000); });
      lines.on("line", (line) => { try { output.accept(line); } catch (error) { failure = error instanceof Error ? error : new CodexCallError("execution"); stop(); } });
      child.on("error", () => { clearTimeout(timer); reject(new CodexCallError("execution")); });
      child.on("close", (code) => {
        clearTimeout(timer); lines.close();
        if (failure || code !== 0) { reject(failure ?? new CodexCallError(failureKind(stderr))); return; }
        try { resolve(output.result()); } catch (error) { reject(error); }
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(prompt);
    });
  } finally { await input.cleanup(); }
};
