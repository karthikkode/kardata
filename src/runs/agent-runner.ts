import { createWriteStream, readdirSync, rmSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { recordEvent } from "../collect/db.js";
import { executeCollectRun, type CollectRunResult } from "../collect/run.js";
import type { Db } from "../db/client.js";
import {
  area,
  areaStatuses,
  companies,
  researchRuns,
  runEvents,
  sources,
  type AgentUsage,
  type ChildUsage,
  type Company,
  type ResearchRun,
} from "../db/schema.js";
import {
  RESEARCH_MUSE_ARGS,
  dockerMuseHarness,
  playwrightServerConfig,
  recoverLabeledContainers,
} from "../harness/docker.js";
import type {
  AgentHarness,
  HarnessEvent,
  HarnessHandle,
  HarnessUsage,
} from "../harness/types.js";
import { hasFreshCollect } from "./agent.js";
import { effectiveMaxAgents } from "./settings.js";
import { redactRunDocs } from "../domain/research/pii.js";
import { collectConcurrency } from "./runner.js";
import { issueRunToken, revokeRunToken } from "./tokens.js";
import { ingestRunSession, rollupUsage, type SessionIngestSummary, type UsageRollup } from "./usage.js";
import { attachDispatchSession, logDispatchPrompt } from "../domain/logging/provider-calls.js";

/**
 * Agent-run runner (Stage 3b Step 2). Drives kind=agent runs through
 * collecting (optional, in-process) → researching (one container per run) →
 * terminal. Cancellation is a DB flag the tick honors; stall and wall-time
 * limits stop the handle with a recorded reason, and classification never
 * trusts the exit code of a stopped run.
 */

export const DEFAULT_POLL_MS = 1000;
export const DEFAULT_STALL_SECONDS = 300;
export const LIVENESS_BUMP_MS = 5_000;
export const RUN_EVENTS_KEEP_DAYS = 7;
const SHUTDOWN_DRAIN_MS = 30_000;
const QUEUE_SCAN_MAX = 20;

/**
 * Browser-fence origins for a company: apex, www and shop subdomains, the
 * website host when it differs, and the Shopify myshopify host when a past
 * shopify fetch reveals one. Both schemes; the fence is about which hosts.
 */
export async function allowedOriginsForCompany(db: Db, company: Company): Promise<string[]> {
  const apex = (company.domain ?? "").toLowerCase().replace(/^www\./, "");
  if (apex === "") return [];
  const hosts = new Set<string>([apex, `www.${apex}`, `shop.${apex}`]);
  if (company.website) {
    try {
      const host = new URL(company.website).hostname.toLowerCase();
      if (host !== "") hosts.add(host);
    } catch {
      // Ignore an unparseable website; the apex fence still holds.
    }
  }
  const [shop] = await db
    .select({ url: sources.url })
    .from(sources)
    .where(and(eq(sources.companyId, company.id), like(sources.url, "%myshopify.com%")))
    .orderBy(desc(sources.fetchedAt))
    .limit(1);
  if (shop) {
    try {
      const host = new URL(shop.url).hostname.toLowerCase();
      if (host.endsWith(".myshopify.com")) hosts.add(host);
    } catch {
      // Ignore an unparseable source URL.
    }
  }
  const origins: string[] = [];
  for (const host of [...hosts].sort()) {
    origins.push(`https://${host}`, `http://${host}`);
  }
  return origins;
}

/** Silence (no stdout events and no MCP calls) before a run is stalled. */
export function stallTimeoutMs(): number {
  const raw = process.env.AGENT_STALL_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_STALL_SECONDS * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n * 1000 : DEFAULT_STALL_SECONDS * 1000;
}

export interface PromptContext {
  run: ResearchRun;
  company: Company;
  brief: string | undefined;
}

export type PromptBuilder = (ctx: PromptContext) => string | Promise<string>;

function missingPromptBuilder(): PromptBuilder {
  return () => {
    throw new Error("agent runner has no prompt builder (wired in Step 3)");
  };
}

export interface AgentRunnerDeps {
  harness?: AgentHarness;
  buildPrompt?: PromptBuilder;
  collect?: (runId: string) => Promise<CollectRunResult>;
  stopLabeledContainers?: () => Promise<string[]>;
  usageRollup?: (main: HarnessUsage | undefined, sessionId: string | undefined) => Promise<UsageRollup>;
  sessionIngest?: (run: ResearchRun, sessionId: string | undefined) => Promise<SessionIngestSummary>;
  /** Container-reachable MCP endpoint, e.g. http://172.31.250.1:8787/mcp. */
  mcpUrl: string;
  maxAgents?: number;
  collectLimit?: number;
  pollMs?: number;
  runsDir?: string;
  stallMs?: number;
}

export interface AgentRunner {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  tick: () => Promise<void>;
  recover: () => Promise<{ failedRuns: string[]; stoppedContainers: string[] }>;
  researchingCount: () => number;
  collectingCount: () => number;
  peakResearching: () => number;
}

type StopReason = "cancelled" | "stall" | "time" | "shutdown";

interface ActiveEntry {
  runId: string;
  phase: "collecting" | "researching";
  handle: HarnessHandle | null;
  researchingStartedAt: Date | null;
  maxMinutes: number;
  stopReason: StopReason | null;
}

interface RunOutcome {
  sessionId?: string;
  containerId?: string;
  exitCode?: number;
  usage?: HarnessUsage;
  finalMessage?: string;
  rollup?: { childrenIncluded: boolean; children: ChildUsage[]; note?: string };
}

const STEP_LIMIT_RE = /within \d+ step/i;

export function defaultRunsDir(): string {
  return join(process.cwd(), "var", "runs");
}

/** Delete run dirs older than keepDays (files are spared). Exported for tests. */
export function pruneRunDirs(runsDir: string, keepDays: number = RUN_EVENTS_KEEP_DAYS): string[] {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  let names: string[];
  try {
    names = readdirSync(runsDir);
  } catch {
    return [];
  }
  const pruned: string[] = [];
  for (const name of names) {
    const path = join(runsDir, name);
    try {
      if (!statSync(path).isDirectory() || statSync(path).mtimeMs >= cutoff) continue;
      rmSync(path, { recursive: true, force: true });
      pruned.push(name);
    } catch {
      /* best effort */
    }
  }
  return pruned;
}

async function loadRun(db: Db, runId: string): Promise<ResearchRun | null> {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  return run ?? null;
}

async function setPhase(db: Db, runId: string, phase: "collecting" | "researching"): Promise<void> {
  await db.update(researchRuns).set({ agentPhase: phase }).where(eq(researchRuns.id, runId));
  await recordEvent(db, runId, "phase", { phase });
}

async function bumpActivity(db: Db, runId: string): Promise<void> {
  await db.update(researchRuns).set({ lastActivityAt: new Date() }).where(eq(researchRuns.id, runId));
}

async function hasAgentFinish(db: Db, runId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: runEvents.id })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "agent_finish")))
    .limit(1);
  return row !== undefined;
}

async function areasWithoutStatus(db: Db, runId: string): Promise<string[]> {
  const rows = await db
    .select({ area: areaStatuses.area })
    .from(areaStatuses)
    .where(eq(areaStatuses.runId, runId));
  const have = new Set(rows.map((r) => r.area));
  // The 7 research areas; "other" is a fallback bucket, never required.
  return (area.enumValues as readonly string[])
    .filter((a) => a !== "other")
    .filter((a) => !have.has(a as never));
}

const FORENSIC_HARNESS_MAX = 10;
const FORENSIC_MCP_MAX = 5;

// Forensics for a stall or time-limit stop: the last normalized harness
// events plus the last MCP calls, as a log note on the run.
async function recordForensicNote(db: Db, runId: string, stopReason: string): Promise<void> {
  const harnessRows = await db
    .select({ id: runEvents.id, at: runEvents.at, payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "harness")))
    .orderBy(desc(runEvents.id))
    .limit(FORENSIC_HARNESS_MAX);
  const mcpRows = await db
    .select({ id: runEvents.id, at: runEvents.at, payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "mcp_call")))
    .orderBy(desc(runEvents.id))
    .limit(FORENSIC_MCP_MAX);
  await recordEvent(db, runId, "log", {
    forensic: true,
    stopReason,
    lastHarness: harnessRows.reverse(),
    lastMcpCalls: mcpRows.reverse(),
  });
}

function toAgentUsage(usage: HarnessUsage): AgentUsage {
  return {
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    reasoningTokens: usage.reasoningTokens,
    calls: usage.calls,
    childrenIncluded: false,
  };
}

function storedUsage(outcome: RunOutcome): AgentUsage | null {
  if (!outcome.usage) return null;
  const merged: AgentUsage = { ...toAgentUsage(outcome.usage) };
  const meta = outcome.rollup;
  if (!meta) return merged;
  merged.childrenIncluded = meta.childrenIncluded;
  if (meta.children.length > 0) merged.children = meta.children;
  if (meta.note) merged.note = meta.note;
  return merged;
}

export function createAgentRunner(db: Db, deps: AgentRunnerDeps): AgentRunner {
  const harness = deps.harness ?? dockerMuseHarness;
  const buildPrompt = deps.buildPrompt ?? missingPromptBuilder();
  const collect = deps.collect ?? ((runId: string) => executeCollectRun(db, runId, { keepOpen: true }));
  const stopLabeled = deps.stopLabeledContainers ?? recoverLabeledContainers;
  const usageRollupFn =
    deps.usageRollup ?? ((main, sessionId) => rollupUsage(main, sessionId));
  const sessionIngestFn =
    deps.sessionIngest ?? ((run, sessionId) => ingestRunSession(db, run, sessionId));
  const collectLimit = deps.collectLimit ?? collectConcurrency();
  const stallMs = deps.stallMs ?? stallTimeoutMs();
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const runsDir = deps.runsDir ?? defaultRunsDir();
  const actives = new Map<string, ActiveEntry>();
  let peak = 0;
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  function researching(): ActiveEntry[] {
    return [...actives.values()].filter((e) => e.phase === "researching");
  }

  function collecting(): ActiveEntry[] {
    return [...actives.values()].filter((e) => e.phase === "collecting");
  }

  function stopOnce(entry: ActiveEntry, reason: StopReason): void {
    if (entry.stopReason) return;
    entry.stopReason = reason;
    if (entry.handle) {
      void entry.handle.stop(reason).catch(() => {
        /* the driver still finalizes from wait() */
      });
    }
  }

  function noteResearching(): void {
    peak = Math.max(peak, researching().length);
  }

  async function finalize(
    runId: string,
    status: ResearchRun["status"],
    error: string | null,
    outcome: RunOutcome,
  ): Promise<void> {
    await db
      .update(researchRuns)
      .set({
        status,
        error,
        finishedAt: new Date(),
        agentSessionId: outcome.sessionId ?? null,
        agentContainerId: outcome.containerId ?? null,
        agentExitCode: outcome.exitCode ?? null,
        agentUsage: storedUsage(outcome),
        agentFinalMessage: outcome.finalMessage ?? null,
      })
      .where(eq(researchRuns.id, runId));
    // Post-research hygiene: redact reviewer attributions from agent docs.
    // Never fails the run; a failure is recorded for forensics.
    try {
      await redactRunDocs(db, runId);
    } catch (err) {
      await recordEvent(db, runId, "log", {
        pii_redact_error: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined);
    }
  }

  async function storeOutcome(runId: string, outcome: RunOutcome): Promise<void> {
    await db
      .update(researchRuns)
      .set({
        agentSessionId: outcome.sessionId ?? null,
        agentContainerId: outcome.containerId ?? null,
        agentExitCode: outcome.exitCode ?? null,
        agentUsage: storedUsage(outcome),
        agentFinalMessage: outcome.finalMessage ?? null,
      })
      .where(eq(researchRuns.id, runId));
  }

  async function drive(runId: string, needsCollect: boolean): Promise<void> {
    const outcome: RunOutcome = {};
    try {
      const run = await loadRun(db, runId);
      if (!run || run.status !== "running") return;
      const options = run.agentOptions ?? {
        recollectDays: 14,
        maxMinutes: 40,
        maxModelSteps: 100,
      };

      if (needsCollect) {
        if ((await loadRun(db, runId))?.status === "cancelled") return;
        await setPhase(db, runId, "collecting");
        const result = await collect(runId);
        await recordEvent(db, runId, "log", { collecting: result.status });
        const after = await loadRun(db, runId);
        if (result.status === "cancelled" || after?.status === "cancelled") {
          if (after?.status === "cancelled") return;
          await finalize(runId, "cancelled", null, outcome);
          return;
        }
        if (!after || after.status !== "running") return;
      }

      if ((await loadRun(db, runId))?.status !== "running") return;
      const entry = actives.get(runId);
      if (entry?.stopReason === "shutdown") {
        await finalize(runId, "failed", "server stopped", outcome);
        return;
      }
      await setPhase(db, runId, "researching");
      if (entry) {
        entry.phase = "researching";
        entry.researchingStartedAt = new Date();
        entry.maxMinutes = options.maxMinutes;
      }
      noteResearching();
      const [company] = await db.select().from(companies).where(eq(companies.id, run.companyId));
      if (!company) throw new Error(`company not found: ${run.companyId}`);
      const prompt = await buildPrompt({ run, company, brief: options.brief });
      // Dispatch capture: the exact turn-1 prompt. Never blocks the launch.
      let dispatchId: number | null = null;
      try {
        dispatchId = await logDispatchPrompt(db, run, prompt);
      } catch (err) {
        console.error(`dispatch prompt log failed for ${runId}: ${err instanceof Error ? err.message : err}`);
      }
      const { token } = await issueRunToken(db, {
        runId,
        companyId: run.companyId,
        ttlMinutes: options.maxMinutes + 10,
      });

      const dir = join(runsDir, runId);
      mkdirSync(dir, { recursive: true });
      const sink = createWriteStream(join(dir, "events.jsonl"), { flags: "a" });
      sink.on("error", () => {});
      const handle = harness.start({
        runId,
        workspaceDir: "/workspace",
        prompt,
        mcpServers: [
          {
            name: "kardata",
            url: deps.mcpUrl,
            headers: { Authorization: "${KARDATA_MCP_AUTH}" },
          },
          playwrightServerConfig(await allowedOriginsForCompany(db, company)),
        ],
        env: { KARDATA_MCP_AUTH: `Bearer ${token}` },
        // No harness stall timer: the runner owns liveness (stdout events
        // plus MCP calls). A harness timer would kill stdout-quiet runs
        // whose subagents are still calling MCP tools.
        limits: { maxModelSteps: options.maxModelSteps, stallTimeoutMs: 0 },
        extraArgs: RESEARCH_MUSE_ARGS,
        onRawLine: (line) => {
          try {
            sink.write(`${line}\n`);
          } catch {
            /* disk errors must not break the run */
          }
        },
      });
      if (entry) entry.handle = handle;
      if (entry?.stopReason) {
        // Stopped before the handle existed (cancel arrived during startup).
        await handle.stop(entry.stopReason).catch(() => {});
      }
      outcome.containerId = handle.containerId;

      let usage: HarnessUsage | undefined;
      let lastTerminal: { terminal: string; reason?: string } | undefined;
      let lastError: string | undefined;
      let lastBump = 0;
      const consume = (async () => {
        for await (const event of handle.events) {
          if (Date.now() - lastBump > LIVENESS_BUMP_MS) {
            lastBump = Date.now();
            await bumpActivity(db, runId);
          }
          const e = event as HarnessEvent;
          if (e.type === "message") continue;
          if (e.type === "started") {
            outcome.sessionId = e.sessionId;
            if (dispatchId !== null) {
              await attachDispatchSession(db, dispatchId, e.sessionId).catch(() => undefined);
            }
          }
          if (e.type === "usage") usage = e;
          if (e.type === "finished") lastTerminal = e;
          if (e.type === "error") lastError = e.message;
          await recordEvent(db, runId, "harness", { ...(e as unknown as Record<string, unknown>) });
        }
      })();
      const result = await handle.wait();
      await consume;
      await new Promise<void>((resolve) => sink.end(resolve));
      outcome.exitCode = result.exitCode;
      const rollup = await usageRollupFn(result.usage ?? usage, outcome.sessionId);
      outcome.usage = rollup.total;
      outcome.rollup = {
        childrenIncluded: rollup.childrenIncluded,
        children: rollup.children,
        note: rollup.note,
      };
      outcome.finalMessage = result.finalMessage || undefined;
      // Per-call ingest from the session log. Gaps are notes, never failures.
      try {
        const ingested = await sessionIngestFn(run, outcome.sessionId);
        if (ingested.note) {
          await recordEvent(db, runId, "log", { session_ingest: ingested.note }).catch(() => undefined);
        }
      } catch (err) {
        console.error(`session ingest failed for ${runId}: ${err instanceof Error ? err.message : err}`);
      }

      const stopped = entry?.stopReason ?? null;
      const current = await loadRun(db, runId);
      if (stopped === "cancelled" || current?.status === "cancelled") {
        if (current?.status === "cancelled") {
          await storeOutcome(runId, outcome);
          return;
        }
        await finalize(runId, "cancelled", null, outcome);
        return;
      }
      if (current && current.status !== "running") {
        // Reaped externally (e.g. the collect runner's stall backstop owns it).
        await storeOutcome(runId, outcome);
        return;
      }
      if (stopped === "stall") {
        await recordForensicNote(db, runId, "stall");
        await finalize(runId, "stalled", null, outcome);
        return;
      }
      if (stopped === "time") {
        await recordForensicNote(db, runId, "time");
        await finalize(runId, "partial", "time limit", outcome);
        return;
      }
      if (stopped === "shutdown") {
        await finalize(runId, "failed", "server stopped", outcome);
        return;
      }
      const reason = lastTerminal?.reason ?? "";
      if (lastTerminal?.terminal === "failed" && STEP_LIMIT_RE.test(reason)) {
        await finalize(runId, "partial", "step limit", outcome);
        return;
      }
      if (result.exitCode !== 0 || lastTerminal?.terminal === "failed") {
        await finalize(runId, "failed", reason || lastError || `exit ${result.exitCode}`, outcome);
        return;
      }
      if (!(await hasAgentFinish(db, runId))) {
        await finalize(runId, "partial", "no run_finish", outcome);
        return;
      }
      // Preflight runs file a report instead of area statuses; the company
      // worker gates on the report itself.
      if (run.stage === "preflight") {
        await finalize(runId, "succeeded", null, outcome);
        return;
      }
      const missing = await areasWithoutStatus(db, runId);
      if (missing.length > 0) {
        await finalize(runId, "partial", `areas without status: ${missing.join(", ")}`, outcome);
        return;
      }
      await finalize(runId, "succeeded", null, outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`agent run ${runId} failed: ${message}`);
      await finalize(runId, "failed", message, outcome).catch(() => {});
    } finally {
      actives.delete(runId);
      await revokeRunToken(db, runId).catch(() => {});
    }
  }

  function launch(runId: string, needsCollect: boolean): void {
    actives.set(runId, {
      runId,
      phase: needsCollect ? "collecting" : "researching",
      handle: null,
      researchingStartedAt: null,
      maxMinutes: 0,
      stopReason: null,
    });
    noteResearching();
    void drive(runId, needsCollect).catch(() => {
      /* drive finalizes its own failures */
    });
  }

  async function claim(runId: string): Promise<boolean> {
    const [row] = await db
      .update(researchRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, "queued")))
      .returning({ id: researchRuns.id });
    return row !== undefined;
  }

  async function checkActive(now: Date): Promise<void> {
    for (const entry of researching()) {
      const row = await loadRun(db, entry.runId);
      if (!row || row.status !== "running") {
        stopOnce(entry, "cancelled");
        continue;
      }
      if (row.lastActivityAt.getTime() < now.getTime() - stallMs) {
        stopOnce(entry, "stall");
        continue;
      }
      const started = entry.researchingStartedAt?.getTime();
      if (started !== undefined && started + entry.maxMinutes * 60_000 < now.getTime()) {
        stopOnce(entry, "time");
      }
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const now = new Date();
      try {
        await checkActive(now);
        noteResearching();
        const maxAgents = await effectiveMaxAgents(db, deps.maxAgents);
        if (researching().length >= maxAgents && collecting().length >= collectLimit) return;
        // Stage 5: company-job subjobs are owned by the company worker; the
        // runner drives preflight ones (recon prompt) and leaves research to
        // Phase 6's stage-aware wiring.
        const queued = await db
          .select()
          .from(researchRuns)
          .where(
            and(
              eq(researchRuns.kind, "agent"),
              eq(researchRuns.status, "queued"),
              sql`${researchRuns.companyJobId} IS NULL OR ${researchRuns.stage} = 'preflight'`,
            ),
          )
          .orderBy(researchRuns.createdAt)
          .limit(QUEUE_SCAN_MAX);
        for (const q of queued) {
          const recollectDays = q.agentOptions?.recollectDays ?? 14;
          const needsCollect = !(await hasFreshCollect(db, q.companyId, recollectDays));
          if (needsCollect && collecting().length >= collectLimit) continue;
          if (!needsCollect && researching().length >= maxAgents) continue;
          if (await claim(q.id)) launch(q.id, needsCollect);
        }
      } catch (err) {
        // A failed tick must not kill the loop (or the process); the next
        // tick retries.
        console.error(`agent tick failed: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      ticking = false;
    }
  }

  async function recover(): Promise<{ failedRuns: string[]; stoppedContainers: string[] }> {
    // Worker-driven extraction subjobs have no container; the company worker
    // reruns them (bulk parity for interrupted extractions).
    const orphans = await db
      .select({ id: researchRuns.id })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.kind, "agent"),
          eq(researchRuns.status, "running"),
          sql`${researchRuns.stage} IS NULL OR ${researchRuns.stage} != 'extraction'`,
        ),
      );
    if (orphans.length === 0) return { failedRuns: [], stoppedContainers: [] };
    let stoppedContainers: string[] = [];
    try {
      stoppedContainers = await stopLabeled();
    } catch (err) {
      console.error(`agent recovery: container stop failed: ${err instanceof Error ? err.message : err}`);
    }
    const failedRuns: string[] = [];
    for (const orphan of orphans) {
      await revokeRunToken(db, orphan.id).catch(() => {});
      await db
        .update(researchRuns)
        .set({ status: "failed", error: "server restarted", finishedAt: new Date() })
        .where(eq(researchRuns.id, orphan.id));
      failedRuns.push(orphan.id);
    }
    return { failedRuns, stoppedContainers };
  }

  return {
    start: async () => {
      await recover();
      try {
        pruneRunDirs(runsDir);
      } catch (err) {
        console.error(`run dir prune failed: ${err instanceof Error ? err.message : err}`);
      }
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, pollMs);
      timer.unref();
      await tick();
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const entry of actives.values()) stopOnce(entry, "shutdown");
      const deadline = Date.now() + SHUTDOWN_DRAIN_MS;
      while (actives.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    tick,
    recover,
    researchingCount: () => researching().length,
    collectingCount: () => collecting().length,
    peakResearching: () => peak,
  };
}
