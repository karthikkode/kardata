import { execFile } from "node:child_process";
import type { ChildUsage } from "../db/schema.js";
import { readerRunArgs } from "../harness/setup.js";
import type { HarnessUsage } from "../harness/types.js";

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
