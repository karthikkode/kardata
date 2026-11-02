import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { CODEX_AUTH_ARGS, CODEX_IMAGE, CODEX_MODEL, codexBaseArgs, codexContainerName } from "./codex-config.js";

export interface CodexWindow { usedPercent: number; windowMinutes: number; resetsAt: string }
export interface CodexSnapshot {
  checkedAt: string; authenticated: boolean | null; modelAvailable: boolean;
  primary: CodexWindow | null; secondary: CodexWindow | null;
  error: "status_unavailable" | "quota_unavailable" | "not_logged_in" | "model_unavailable" | "provider_limit" | null;
  diagnostic?: { stage: string; rpcCode: number | null; exitCode: number | null };
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function windowOf(value: unknown): CodexWindow | null {
  const v = object(value);
  if (typeof v.usedPercent !== "number" || !Number.isFinite(v.usedPercent) || v.usedPercent < 0 || v.usedPercent > 100 ||
      typeof v.windowDurationMins !== "number" || !Number.isFinite(v.windowDurationMins) || v.windowDurationMins <= 0 ||
      typeof v.resetsAt !== "number" || !Number.isFinite(v.resetsAt)) return null;
  const date = new Date(v.resetsAt * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return { usedPercent: v.usedPercent, windowMinutes: v.windowDurationMins, resetsAt: date.toISOString() };
}

/** Only allowlisted auth/model/quota fields escape the CLI response. Never return account or token payloads. */
export function parseCodexSnapshot(account: unknown, models: unknown, limits: unknown, now = new Date()): CodexSnapshot {
  const authenticated = object(object(account).account).type === "chatgpt";
  const entries = object(models).data;
  const modelAvailable = Array.isArray(entries) && entries.some((entry: unknown) => {
    const m = object(entry);
    return (m.model === CODEX_MODEL || m.id === CODEX_MODEL) && Array.isArray(m.supportedReasoningEfforts) &&
      m.supportedReasoningEfforts.some((e: unknown) => object(e).reasoningEffort === "medium");
  });
  const result = object(limits), buckets = object(result.rateLimitsByLimitId);
  const bucket = object(buckets[CODEX_MODEL] ?? buckets.codex ?? result.rateLimits);
  const primary = windowOf(bucket.primary), secondary = windowOf(bucket.secondary);
  const quotaKnown = primary !== null && (bucket.secondary === null || secondary !== null);
  return { checkedAt: now.toISOString(), authenticated, modelAvailable, primary, secondary,
    error: !authenticated ? "not_logged_in" : !modelAvailable ? "model_unavailable" : !quotaKnown ? "quota_unavailable" :
      bucket.rateLimitReachedType != null ? "provider_limit" : null };
}

export function codexHasCapacity(snapshot: CodexSnapshot, now = Date.now()): boolean {
  const age = now - Date.parse(snapshot.checkedAt);
  if (snapshot.error || snapshot.authenticated !== true || !snapshot.modelAvailable || !Number.isFinite(age) || age < -5000 || age > 600000 || !snapshot.primary) return false;
  return [snapshot.primary, snapshot.secondary].every((w) => w === null ||
    (Date.parse(w.resetsAt) > now && w.usedPercent < (w.windowMinutes >= 10080 ? 100 : 95)));
}

/** Non-model JSON-RPC inspection of the app-owned Codex installation. */
export async function readCodexSnapshot(): Promise<CodexSnapshot> {
  const name = codexContainerName(randomUUID(), "status");
  const child = spawn("docker", [...codexBaseArgs(), "--name", name, CODEX_IMAGE, ...CODEX_AUTH_ARGS, "app-server"], { stdio: ["pipe", "pipe", "ignore"] });
  const pending = new Map<number, { resolve: (x: unknown) => void; reject: (e: Error) => void }>();
  const lines = createInterface({ input: child.stdout });
  let sequence = 0;
  let stage = "initialize", rpcCode: number | null = null, exitCode: number | null = null;
  const fail = () => { for (const p of pending.values()) p.reject(new Error("Codex status unavailable")); pending.clear(); };
  child.on("error", fail); child.on("exit", (code) => { exitCode = code; fail(); });
  child.stdin.on("error", fail);
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as Record<string, unknown>;
      const p = pending.get(message.id as number);
      if (!p) return;
      pending.delete(message.id as number);
      if (message.error) {
        const code = object(message.error).code;
        rpcCode = typeof code === "number" && Number.isFinite(code) ? code : null;
        p.reject(new Error("Codex status request failed"));
      } else p.resolve(message.result);
    } catch { /* Ignore diagnostics, never expose raw response content. */ }
  });
  const request = (method: string, params?: unknown) => new Promise<unknown>((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + "\n");
  });
  const timer = setTimeout(() => { fail(); child.kill("SIGTERM"); }, 30000);
  try {
    await request("initialize", { clientInfo: { name: "kardata", version: "2.0.0" } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    stage = "account";
    const account = await request("account/read", { refreshToken: false });
    if (object(object(account).account).type !== "chatgpt") return parseCodexSnapshot(account, null, null);
    stage = "models";
    const models = await request("model/list", { limit: 100, includeHidden: true });
    stage = "quota";
    const limits = await request("account/rateLimits/read");
    return parseCodexSnapshot(account, models, limits);
  } catch {
    return { checkedAt: new Date().toISOString(), authenticated: null, modelAvailable: false,
      primary: null, secondary: null, error: "status_unavailable", diagnostic: { stage, rpcCode, exitCode } };
  } finally {
    clearTimeout(timer); lines.close(); child.stdin.end(); child.kill("SIGTERM");
    const stop = spawn("docker", ["stop", "-t", "1", name], { stdio: "ignore" }); stop.on("error", () => undefined);
  }
}
