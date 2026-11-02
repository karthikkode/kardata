import { expect, it } from "vitest";
import { CodexExtractionOutput, CodexCallError } from "../../src/harness/codex-extract.js";

it("accepts a completed schema response and counts cached input only once", () => {
  const out = new CodexExtractionOutput();
  out.accept(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"value":true}' } }));
  out.accept(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 200, cached_input_tokens: 120, output_tokens: 10, reasoning_output_tokens: 3 } }));
  expect(out.result()).toMatchObject({ json: { value: true }, usage: { model: "gpt-6.1-terra", inputTokens: 80, cachedTokens: 120, outputTokens: 10, reasoningTokens: 3, calls: 1 } });
});
it("rejects partial/invalid final responses and tool activity", () => {
  const out = new CodexExtractionOutput();
  expect(() => out.result()).toThrow(CodexCallError);
  expect(() => out.accept(JSON.stringify({ type: "item.started", item: { type: "command_execution" } }))).toThrow(CodexCallError);
  out.accept(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "not JSON" } }));
  out.accept(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 1 } }));
  expect(() => out.result()).toThrow(CodexCallError);
});
it.each([["You've hit your usage limit", "quota"], ["Authentication required", "auth"], ["request failed", "execution"]])("classifies provider failures without exposing their payload", (message, kind) => {
  const out = new CodexExtractionOutput();
  try { out.accept(JSON.stringify({ type: "turn.failed", error: { message } })); throw new Error("expected failure"); }
  catch (error) { expect(error).toBeInstanceOf(CodexCallError); expect((error as CodexCallError).kind).toBe(kind); expect((error as Error).message).not.toBe(message); }
});


it("lets the CLI recover nonterminal reconnect and transport-warning events", () => {
  const out = new CodexExtractionOutput();
  out.accept(JSON.stringify({ type: "error", message: "Reconnecting... 1/5 (stream disconnected; private diagnostic omitted)" }));
  out.accept(JSON.stringify({ type: "item.completed", item: { type: "error", message: "Falling back from WebSockets to HTTPS transport" } }));
  out.accept(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"value":true}' } }));
  out.accept(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5 } }));
  expect(out.result().json).toEqual({ value: true });
});
it("requires a successful terminal turn even after recoverable notices", () => {
  const out = new CodexExtractionOutput();
  out.accept(JSON.stringify({ type: "error", message: "Reconnecting... stream closed SECRET" }));
  out.accept(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"value":true}' } }));
  expect(() => out.result()).toThrow("transport");
  expect(() => out.accept(JSON.stringify({ type: "turn.failed", error: { message: "HTTP429 too many requests SECRET" } }))).toThrow("rate_limited");
  try { out.accept(JSON.stringify({ type: "turn.failed", error: { message: "Authentication required SECRET" } })); }
  catch (error) { expect((error as CodexCallError).kind).toBe("auth"); expect((error as Error).message).not.toContain("SECRET"); }
});
