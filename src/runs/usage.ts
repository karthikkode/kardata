import { execFile } from "node:child_process";
import type { ChildUsage, ResearchRun } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { sessionReaderRunArgs, readerRunArgs } from "../harness/setup.js";
import type { HarnessUsage } from "../harness/types.js";
import { ingestSessionCalls, type SessionCall } from "../domain/logging/provider-calls.js";

/**
 * Subagent usage rollup (Stage 3b.1): the exec stream's run.usage covers the
 * main run only (children_included is false), so after each run the
 * usage-reader collects per-child totals from the session logs in the
 * kardata_muse volume and the stored usage becomes main + children.
 */

export interface UsageRollup {
  total: HarnessUsage | undefined;
  childrenIncluded: boolean;
  children: ChildUsage[];
  note?: string;
}

export const ZERO_USAGE: HarnessUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  calls: 0,
};

export function totalUsage(main: HarnessUsage | undefined, children: ChildUsage[]): HarnessUsage {
  const total: HarnessUsage = { ...ZERO_USAGE };
  const model = main?.model ?? children.find((c) => c.model)?.model;
  if (model) total.model = model;
  const add = (u: HarnessUsage | ChildUsage): void => {
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.cachedTokens += u.cachedTokens;
    total.reasoningTokens += u.reasoningTokens;
    total.calls += u.calls;
  };
  if (main) add(main);
  for (const child of children) add(child);
  return total;
}

export type ReaderCall = (args: string[]) => Promise<{ ok: boolean; stdout: string }>;

function defaultReaderCall(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) resolve({ ok: false, stdout: "" });
      else resolve({ ok: true, stdout });
    });
  });
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sanitizeChild(value: unknown): ChildUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== "string" || v.sessionId === "") return null;
  const child: ChildUsage = {
    sessionId: v.sessionId,
    inputTokens: num(v.inputTokens),
    outputTokens: num(v.outputTokens),
    cachedTokens: num(v.cachedTokens),
    reasoningTokens: num(v.reasoningTokens),
    calls: num(v.calls),
  };
  if (typeof v.model === "string") child.model = v.model;
  return child;
}

function withoutChildren(main: HarnessUsage | undefined, note: string): UsageRollup {
  return { total: main, childrenIncluded: false, children: [], note };
}

export async function rollupUsage(
  main: HarnessUsage | undefined,
  sessionId: string | undefined,
  runReader: ReaderCall = defaultReaderCall,
): Promise<UsageRollup> {
  if (!sessionId) {
    return withoutChildren(main, "no session id (harness never emitted started)");
  }
  let out: { ok: boolean; stdout: string };
  try {
    out = await runReader(readerRunArgs(sessionId));
  } catch (err) {
    return withoutChildren(main, `usage reader failed: ${err instanceof Error ? err.message : err}`);
  }
  if (!out.ok) {
    return withoutChildren(main, "usage reader container failed (docker unavailable?)");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.stdout);
  } catch {
    return withoutChildren(main, "usage reader returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { children?: unknown }).children)) {
    return withoutChildren(main, "usage reader returned an unexpected shape");
  }
  const { children, note } = parsed as { children: unknown[]; note?: unknown };
  const clean = children.map(sanitizeChild).filter((c): c is ChildUsage => c !== null);
  if (clean.length === 0) {
    return withoutChildren(main, typeof note === "string" ? note : "no child usage found");
  }
  const rollup: UsageRollup = { total: totalUsage(main, clean), childrenIncluded: true, children: clean };
  if (typeof note === "string") rollup.note = note;
  return rollup;
}

export interface SessionIngestSummary {
  calls: number;
  note?: string;
}

function sanitizeCall(value: unknown): SessionCall | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.session_id !== "string" || v.session_id === "") return null;
  const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
  const messages = Array.isArray(v.messages)
    ? v.messages.flatMap((m) =>
        typeof m === "object" && m !== null && typeof (m as { text?: unknown }).text === "string"
          ? [{ phase: str((m as { phase?: unknown }).phase), text: (m as { text: string }).text }]
          : [],
      )
    : [];
  const toolCalls = Array.isArray(v.tool_calls)
    ? v.tool_calls.flatMap((c) =>
        typeof c === "object" && c !== null && typeof (c as { name?: unknown }).name === "string"
          ? [{ name: (c as { name: string }).name, call_id: str((c as { call_id?: unknown }).call_id) }]
          : [],
      )
    : [];
  return {
    usage_id: str(v.usage_id),
    session_id: v.session_id,
    child_session_id: str(v.child_session_id),
    seq: num(v.seq),
    response_id: str(v.response_id),
    model: str(v.model),
    provider: str(v.provider),
    input_tokens: num(v.input_tokens),
    output_tokens: num(v.output_tokens),
    cached_tokens: num(v.cached_tokens),
    reasoning_tokens: num(v.reasoning_tokens),
    at: str(v.at),
    messages,
    tool_calls: toolCalls,
  };
}

/**
 * Post-run per-call ingest (Stage 5 Phase 3): read the session log through
 * the session-reader and store one provider_calls row per provider call.
 * Never throws: gaps are notes, like the usage rollup.
 */
export async function ingestRunSession(
  db: Db,
  run: ResearchRun,
  sessionId: string | undefined,
  runReader: ReaderCall = defaultReaderCall,
): Promise<SessionIngestSummary> {
  if (!sessionId) return { calls: 0, note: "no session id (harness never emitted started)" };
  let out: { ok: boolean; stdout: string };
  try {
    out = await runReader(sessionReaderRunArgs(sessionId));
  } catch (err) {
    return { calls: 0, note: `session reader failed: ${err instanceof Error ? err.message : err}` };
  }
  if (!out.ok) return { calls: 0, note: "session reader container failed (docker unavailable?)" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.stdout);
  } catch {
    return { calls: 0, note: "session reader returned invalid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { calls?: unknown }).calls)) {
    return { calls: 0, note: "session reader returned an unexpected shape" };
  }
  const { calls, note } = parsed as { calls: unknown[]; note?: unknown };
  const clean = calls.map(sanitizeCall).filter((c): c is SessionCall => c !== null);
  try {
    const { inserted } = await ingestSessionCalls(db, run, clean);
    const summary: SessionIngestSummary = { calls: inserted };
    if (typeof note === "string") summary.note = note;
    else if (clean.length === 0) summary.note = "no provider calls found";
    return summary;
  } catch (err) {
    return { calls: 0, note: `session ingest failed: ${err instanceof Error ? err.message : err}` };
  }
}
