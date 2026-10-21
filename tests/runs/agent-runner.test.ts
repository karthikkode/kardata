import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { recordEvent } from "../../src/collect/db.js";
import type { CollectRunResult } from "../../src/collect/run.js";
import type { DbHandle } from "../../src/db/client.js";
import { area, blobs, companies, providerCalls, researchRuns, runEvents, sources } from "../../src/db/schema.js";
import { setAreaStatus } from "../../src/domain/research/status.js";
import { PLAYWRIGHT_SERVER_CONFIG, RESEARCH_MUSE_ARGS } from "../../src/harness/docker.js";
import type {
  AgentHarness,
  HarnessEvent,
  HarnessHandle,
  HarnessStartOptions,
  HarnessUsage,
  HarnessWaitResult,
} from "../../src/harness/types.js";
import { researchStart } from "../../src/runs/agent.js";
import {
  allowedOriginsForCompany,
  createAgentRunner,
  pruneRunDirs,
  stallTimeoutMs,
  type AgentRunner,
  type PromptContext,
} from "../../src/runs/agent-runner.js";
import { cancelRun } from "../../src/runs/queue.js";
import { startCompanyJob } from "../../src/runs/company.js";
import { authenticateRunToken, issueRunToken } from "../../src/runs/tokens.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

interface FakeScript {
  events?: HarnessEvent[];
  exitCode?: number;
  finalMessage?: string;
  usage?: HarnessUsage;
  rawLines?: string[];
  hang?: boolean;
}

class FakeHandle implements HarnessHandle {
  readonly containerId: string;
  stopReason: string | null = null;
  readonly yielded: HarnessEvent[] = [];
  readonly events: AsyncIterable<HarnessEvent>;
  private released = false;
  private releaseWaiters: (() => void)[] = [];

  constructor(
    readonly runId: string,
    private script: FakeScript,
    private onRawLine?: (line: string) => void,
  ) {
    this.containerId = `fake-container-${runId}`;
    this.events = { [Symbol.asyncIterator]: () => this.iterate() };
  }

  release(): void {
    this.released = true;
    for (const waiter of this.releaseWaiters.splice(0)) waiter();
  }

  private async *iterate(): AsyncGenerator<HarnessEvent> {
    for (const line of this.script.rawLines ?? []) this.onRawLine?.(line);
    for (const event of this.script.events ?? []) {
      if (this.stopReason) return;
      this.yielded.push(event);
      yield event;
    }
  }

  async stop(reason: string): Promise<void> {
    this.stopReason = reason;
    this.release();
  }

  async wait(): Promise<HarnessWaitResult> {
    if (this.script.hang && !this.released) {
      await new Promise<void>((resolve) => this.releaseWaiters.push(resolve));
    }
    return {
      exitCode: this.script.exitCode ?? 0,
      finalMessage: this.script.finalMessage ?? "",
      usage: this.script.usage,
    };
  }
}

class FakeHarness implements AgentHarness {
  readonly starts: HarnessStartOptions[] = [];
  readonly handles = new Map<string, FakeHandle>();

  constructor(public scriptFor: (runId: string) => FakeScript) {}

  start(opts: HarnessStartOptions): FakeHandle {
    this.starts.push(opts);
    const handle = new FakeHandle(opts.runId, this.scriptFor(opts.runId), opts.onRawLine);
    this.handles.set(opts.runId, handle);
    return handle;
  }
}

const MCP_URL = "http://host.docker.internal:9999/mcp";

let handle: DbHandle;
let runsDir: string;
let runner: AgentRunner | null = null;

const COMPLETED: HarnessEvent = { type: "finished", terminal: "completed", text: "ok" };
const USAGE: HarnessUsage = {
  model: "fake-model",
  inputTokens: 100,
  outputTokens: 20,
  cachedTokens: 50,
  reasoningTokens: 7,
  calls: 2,
};

async function makeCompany(name: string): Promise<string> {
  const id = randomUUID();
  await handle.db.insert(companies).values({ id, source: "manual", name });
  return id;
}

async function freshCollect(companyId: string): Promise<void> {
  await handle.db.insert(researchRuns).values({
    id: randomUUID(),
    companyId,
    kind: "collect",
    status: "succeeded",
    createdBy: "owner",
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    finishedAt: new Date(Date.now() - 60 * 60 * 1000),
  });
}

async function arrangeFinish(runId: string, areas = 7): Promise<void> {
  await recordEvent(handle.db, runId, "agent_finish", { summary: "s" });
  const names = (area.enumValues as readonly string[]).filter((n) => n !== "other");
  for (const name of names.slice(0, areas)) {
    await setAreaStatus(handle.db, { runId, area: name, status: "done", reason: null });
  }
}

async function runRow(runId: string) {
  const [row] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!row) throw new Error(`run missing: ${runId}`);
  return row;
}

async function drain(runId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const row = await runRow(runId);
    if (row.status !== "queued" && row.status !== "running") return;
    if (Date.now() > deadline) throw new Error(`run ${runId} stuck in ${row.status}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function waitForHandle(harness: FakeHarness, runId: string): Promise<FakeHandle> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const found = harness.handles.get(runId);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`no handle for ${runId}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface Fixture {
  runner: AgentRunner;
  harness: FakeHarness;
  collectCalls: string[];
  prompts: PromptContext[];
  stopLabeledCalls: number;
}

function makeFixture(opts: {
  scriptFor?: (runId: string) => FakeScript;
  collectImpl?: (runId: string) => Promise<CollectRunResult>;
  maxAgents?: number;
  collectLimit?: number;
  buildPrompt?: null;
  stallMs?: number;
  sessionIngest?: (
    runId: string,
    sessionId: string | undefined,
  ) => Promise<import("../../src/runs/usage.js").SessionIngestSummary>;
  usageRollup?: (
    main: HarnessUsage | undefined,
    sessionId: string | undefined,
  ) => Promise<import("../../src/runs/usage.js").UsageRollup>;
}): Fixture {
  const harness = new FakeHarness(opts.scriptFor ?? (() => ({ events: [COMPLETED] })));
  const collectCalls: string[] = [];
  const prompts: PromptContext[] = [];
  const fixture: Fixture = {
    runner: null as unknown as AgentRunner,
    harness,
    collectCalls,
    prompts,
    stopLabeledCalls: 0,
  };
  fixture.runner = createAgentRunner(handle.db, {
    harness,
    mcpUrl: MCP_URL,
    maxAgents: opts.maxAgents,
    collectLimit: opts.collectLimit,
    pollMs: 60_000,
    runsDir,
    stallMs: opts.stallMs,
    usageRollup:
      opts.usageRollup ?? (async (main) => ({ total: main, childrenIncluded: false, children: [] })),
    sessionIngest:
      opts.sessionIngest !== undefined
        ? async (run, sessionId) => opts.sessionIngest?.(run.id, sessionId) ?? { calls: 0 }
        : async () => ({ calls: 0 }),
    collect: async (runId: string) => {
      collectCalls.push(runId);
      if (opts.collectImpl) return opts.collectImpl(runId);
      return { runId, status: "succeeded", outcomes: [], adapters: [], skippedAdapters: [], unknownAdapters: [] };
    },
    stopLabeledContainers: async () => {
      fixture.stopLabeledCalls += 1;
      return ["container-1"];
    },
    ...(opts.buildPrompt === null
      ? {}
      : {
          buildPrompt: (ctx: PromptContext) => {
            prompts.push(ctx);
            return `prompt for ${ctx.company.id} :: ${ctx.brief ?? ""}`;
          },
        }),
  });
  runner = fixture.runner;
  return fixture;
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

beforeEach(async () => {
  await resetTestDb(handle);
  runsDir = mkdtempSync(join(tmpdir(), "agent-runner-test-"));
});

afterEach(async () => {
  if (runner) {
    await runner.stop();
    runner = null;
  }
  rmSync(runsDir, { recursive: true, force: true });
});

describe("allowedOriginsForCompany", () => {
  async function companyWith(opts: { domain?: string | null; website?: string | null }) {
    const id = randomUUID();
    await handle.db.insert(companies).values({ id, source: "manual", name: "Fence Co", ...opts });
    const [row] = await handle.db.select().from(companies).where(eq(companies.id, id));
    if (!row) throw new Error("no company row");
    return row;
  }

  it("fences apex, www, shop and the website host", async () => {
    const company = await companyWith({ domain: "shop.example", website: "https://store.example/shop" });
    const origins = await allowedOriginsForCompany(handle.db, company);
    expect(origins).toEqual([
      "https://shop.example",
      "http://shop.example",
      "https://shop.shop.example",
      "http://shop.shop.example",
      "https://store.example",
      "http://store.example",
      "https://www.shop.example",
      "http://www.shop.example",
    ]);
  });

  it("adds the myshopify host from past shopify fetches", async () => {
    const company = await companyWith({ domain: "brand.example" });
    const runId = randomUUID();
    await handle.db.insert(researchRuns).values({ id: runId, companyId: company.id, kind: "collect", status: "succeeded" });
    await handle.db.insert(sources).values({
      id: randomUUID(),
      companyId: company.id,
      runId,
      url: "https://brand-1.myshopify.com/products.json",
      finalUrl: "https://brand-1.myshopify.com/products.json",
      collector: "shopify",
      status: "ok",
    });
    const origins = await allowedOriginsForCompany(handle.db, company);
    expect(origins).toContain("https://brand-1.myshopify.com");
    expect(origins).toContain("https://brand.example");
  });

  it("returns no origins without a domain", async () => {
    const company = await companyWith({ domain: null, website: null });
    await expect(allowedOriginsForCompany(handle.db, company)).resolves.toEqual([]);
  });
});

describe("agent runner", () => {
  it("collects stale companies before researching, in order", async () => {
    const order: string[] = [];
    const fx = makeFixture({
      scriptFor: () => ({ events: [COMPLETED] }),
      collectImpl: async (runId) => {
        order.push("collect");
        return { runId, status: "succeeded", outcomes: [], adapters: [], skippedAdapters: [], unknownAdapters: [] };
      },
    });
    const companyId = await makeCompany("A Co");
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId);
    const origScript = fx.harness.scriptFor;
    fx.harness.scriptFor = (id: string) => {
      order.push("research");
      return origScript(id);
    };

    await fx.runner.tick();
    await drain(runId);
    expect(order).toEqual(["collect", "research"]);
    expect((await runRow(runId)).status).toBe("succeeded");
    const phases = await handle.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(eq(runEvents.runId, runId));
    const names = phases
      .map((r) => (r.payload as { phase?: string }).phase)
      .filter((p) => p !== undefined);
    expect(names).toEqual(["collecting", "researching"]);
  });

  it("skips collecting when a fresh collect exists", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId);

    await fx.runner.tick();
    await drain(runId);
    expect(fx.collectCalls).toEqual([]);
    expect(fx.harness.starts).toHaveLength(1);
    expect((await runRow(runId)).status).toBe("succeeded");
  });

  it("passes the Step 0 container config to the harness", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, {
      companyIds: [companyId],
      maxMinutes: 10,
      maxModelSteps: 25,
      brief: "owner note",
    });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId);

    await fx.runner.tick();
    await drain(runId);
    expect(fx.harness.starts).toHaveLength(1);
    const opts = fx.harness.starts[0] as HarnessStartOptions;
    expect(Object.keys(opts.env)).toEqual(["KARDATA_MCP_AUTH"]);
    expect(opts.env["KARDATA_MCP_AUTH"]).toMatch(/^Bearer krau_/);
    expect(opts.mcpServers[0]).toEqual({
      name: "kardata",
      url: MCP_URL,
      headers: { Authorization: "${KARDATA_MCP_AUTH}" },
    });
    expect(opts.mcpServers[1]).toEqual(PLAYWRIGHT_SERVER_CONFIG);
    expect(opts.extraArgs).toEqual(RESEARCH_MUSE_ARGS);
    expect(opts.limits.maxModelSteps).toBe(25);
    // The runner owns liveness; the harness timer stays off.
    expect(opts.limits.stallTimeoutMs).toBe(0);
    expect(opts.prompt).toContain("owner note");
    expect(fx.prompts[0]?.run.id).toBe(runId);
    expect(fx.prompts[0]?.company.id).toBe(companyId);
    // The token worked during the run and is revoked at the end.
    expect(await authenticateRunToken(handle.db, (opts.env["KARDATA_MCP_AUTH"] as string).slice(7))).toBeNull();
    expect((await runRow(runId)).agentContainerId).toBe(`fake-container-${runId}`);
  });

  it("caps researching concurrency", async () => {
    const fx = makeFixture({
      maxAgents: 2,
      scriptFor: () => ({ hang: true, exitCode: 0 }),
    });
    const ids = [await makeCompany("A Co"), await makeCompany("B Co"), await makeCompany("C Co")];
    for (const id of ids) await freshCollect(id);
    const started = await researchStart(handle.db, { companyIds: ids });
    const runIds = started.runs.map((r) => (r as { runId: string }).runId);
    for (const runId of runIds) await arrangeFinish(runId);

    await fx.runner.tick();
    expect(fx.runner.researchingCount()).toBe(2);
    expect(fx.runner.peakResearching()).toBe(2);
    const states = await Promise.all(runIds.map((id) => runRow(id)));
    const running = states.filter((r) => r.status === "running").map((r) => r.id);
    const queued = states.filter((r) => r.status === "queued").map((r) => r.id);
    expect(running).toHaveLength(2);
    expect(queued).toHaveLength(1);

    for (const id of running) (await waitForHandle(fx.harness, id)).release();
    for (const id of running) await drain(id);
    await fx.runner.tick();
    expect(fx.runner.researchingCount()).toBe(1);
    for (const id of queued) (await waitForHandle(fx.harness, id)).release();
    for (const runId of runIds) await drain(runId);
    expect(fx.runner.peakResearching()).toBe(2);
  });

  it("caps collecting with the collect limit", async () => {
    let releaseCollect: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseCollect = resolve;
    });
    const fx = makeFixture({
      maxAgents: 5,
      collectLimit: 1,
      scriptFor: () => ({ events: [COMPLETED] }),
      collectImpl: async (runId) => {
        await gate;
        return { runId, status: "succeeded", outcomes: [], adapters: [], skippedAdapters: [], unknownAdapters: [] };
      },
    });
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const started = await researchStart(handle.db, { companyIds: [a, b] });
    const runIds = started.runs.map((r) => (r as { runId: string }).runId);
    for (const runId of runIds) await arrangeFinish(runId);

    await fx.runner.tick();
    expect(fx.runner.collectingCount()).toBe(1);
    const states = await Promise.all(runIds.map((id) => runRow(id)));
    const running = states.filter((r) => r.status === "running").map((r) => r.id);
    const queued = states.filter((r) => r.status === "queued").map((r) => r.id);
    expect(running).toHaveLength(1);
    expect(queued).toHaveLength(1);

    releaseCollect();
    for (const id of running) await drain(id);
    await fx.runner.tick();
    for (const runId of runIds) await drain(runId);
    expect(fx.collectCalls).toHaveLength(2);
  });

  it("stalls quiet runs (exit code does not save them)", async () => {
    const fx = makeFixture({ scriptFor: () => ({ hang: true, exitCode: 0 }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    const h = await waitForHandle(fx.harness, runId);
    await handle.db
      .update(researchRuns)
      .set({ lastActivityAt: new Date(Date.now() - 310_000) })
      .where(eq(researchRuns.id, runId));
    await fx.runner.tick();
    expect(h.stopReason).toBe("stall");
    await drain(runId);
    const row = await runRow(runId);
    expect(row.status).toBe("stalled");
    expect(row.agentExitCode).toBe(0);
  });

  it("stores a forensic note on stall (last 10 harness + last 5 MCP)", async () => {
    const fx = makeFixture({ scriptFor: () => ({ hang: true, exitCode: 0 }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    const h = await waitForHandle(fx.harness, runId);
    for (let i = 0; i < 12; i += 1) await recordEvent(handle.db, runId, "harness", { seq: i });
    for (let i = 0; i < 7; i += 1) await recordEvent(handle.db, runId, "mcp_call", { tool: `t${i}` });
    await handle.db
      .update(researchRuns)
      .set({ lastActivityAt: new Date(Date.now() - 310_000) })
      .where(eq(researchRuns.id, runId));
    await fx.runner.tick();
    expect(h.stopReason).toBe("stall");
    await drain(runId);

    const notes = await handle.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "log")));
    expect(notes).toHaveLength(1);
    const payload = notes[0].payload as {
      forensic: boolean;
      stopReason: string;
      lastHarness: { payload: { seq: number } }[];
      lastMcpCalls: { payload: { tool: string } }[];
    };
    expect(payload.forensic).toBe(true);
    expect(payload.stopReason).toBe("stall");
    expect(payload.lastHarness.map((e) => e.payload.seq)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(payload.lastMcpCalls.map((e) => e.payload.tool)).toEqual(["t2", "t3", "t4", "t5", "t6"]);
  });

  it("stores rolled-up usage with per-child rows", async () => {
    const fx = makeFixture({
      scriptFor: () => ({ events: [COMPLETED], usage: USAGE }),
      usageRollup: async () => ({
        total: { ...USAGE, inputTokens: 300, outputTokens: 60, calls: 5 },
        childrenIncluded: true,
        children: [
          {
            sessionId: "child-1",
            model: "m",
            inputTokens: 200,
            outputTokens: 40,
            cachedTokens: 0,
            reasoningTokens: 0,
            calls: 3,
          },
        ],
      }),
    });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId);

    await fx.runner.tick();
    await drain(runId);
    expect((await runRow(runId)).agentUsage).toEqual({
      model: "fake-model",
      inputTokens: 300,
      outputTokens: 60,
      cachedTokens: 50,
      reasoningTokens: 7,
      calls: 5,
      childrenIncluded: true,
      children: [
        {
          sessionId: "child-1",
          model: "m",
          inputTokens: 200,
          outputTokens: 40,
          cachedTokens: 0,
          reasoningTokens: 0,
          calls: 3,
        },
      ],
    });
  });

  it("defaults the stall timeout to 300s and honors AGENT_STALL_SECONDS", () => {
    const saved = process.env.AGENT_STALL_SECONDS;
    try {
      delete process.env.AGENT_STALL_SECONDS;
      expect(stallTimeoutMs()).toBe(300_000);
      process.env.AGENT_STALL_SECONDS = "45";
      expect(stallTimeoutMs()).toBe(45_000);
      process.env.AGENT_STALL_SECONDS = "bogus";
      expect(stallTimeoutMs()).toBe(300_000);
    } finally {
      if (saved === undefined) delete process.env.AGENT_STALL_SECONDS;
      else process.env.AGENT_STALL_SECONDS = saved;
    }
  });

  it("marks over-time runs partial", async () => {
    const fx = makeFixture({ scriptFor: () => ({ hang: true, exitCode: 0 }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId], maxMinutes: 0.02 });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    const h = await waitForHandle(fx.harness, runId);
    await new Promise((r) => setTimeout(r, 2000));
    await fx.runner.tick();
    expect(h.stopReason).toBe("time");
    await drain(runId);
    const row = await runRow(runId);
    expect(row.status).toBe("partial");
    expect(row.error).toBe("time limit");
    const notes = await handle.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "log")));
    expect(notes).toHaveLength(1);
    expect((notes[0].payload as { stopReason: string }).stopReason).toBe("time");
  });

  it("cancels researching runs", async () => {
    const fx = makeFixture({ scriptFor: () => ({ hang: true, exitCode: 0 }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    const h = await waitForHandle(fx.harness, runId);
    await cancelRun(handle.db, runId);
    await fx.runner.tick();
    expect(h.stopReason).toBe("cancelled");
    await drain(runId);
    expect((await runRow(runId)).status).toBe("cancelled");
  });

  it("cancels collecting runs before researching starts", async () => {
    let releaseCollect: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseCollect = resolve;
    });
    const fx = makeFixture({
      scriptFor: () => ({ events: [COMPLETED] }),
      collectImpl: async (runId) => {
        await gate;
        return { runId, status: "succeeded", outcomes: [], adapters: [], skippedAdapters: [], unknownAdapters: [] };
      },
    });
    const companyId = await makeCompany("A Co");
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    await cancelRun(handle.db, runId);
    releaseCollect();
    await drain(runId);
    expect((await runRow(runId)).status).toBe("cancelled");
    expect(fx.harness.starts).toHaveLength(0);
  });

  it("marks a collector-cancelled collect as cancelled", async () => {
    const fx = makeFixture({
      scriptFor: () => ({ events: [COMPLETED] }),
      collectImpl: async (runId) => ({ runId, status: "cancelled", outcomes: [], adapters: [], skippedAdapters: [], unknownAdapters: [] }),
    });
    const companyId = await makeCompany("A Co");
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    await drain(runId);
    expect((await runRow(runId)).status).toBe("cancelled");
    expect(fx.harness.starts).toHaveLength(0);
  });

  it("marks exit 0 without run_finish as partial", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    await drain(runId);
    const row = await runRow(runId);
    expect(row.status).toBe("partial");
    expect(row.error).toBe("no run_finish");
  });

  it("marks missing area statuses as partial", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId, 3);

    await fx.runner.tick();
    await drain(runId);
    const row = await runRow(runId);
    expect(row.status).toBe("partial");
    expect(row.error ?? "").toMatch(/^areas without status: /);
  });

  it("fails non-zero exits with the last error", async () => {
    const byRun = new Map<string, FakeScript>();
    const fx = makeFixture({
      scriptFor: (runId) => byRun.get(runId) ?? { events: [], exitCode: 5 },
    });
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    await freshCollect(a);
    await freshCollect(b);
    const started = await researchStart(handle.db, { companyIds: [a, b] });
    const runIds = started.runs.map((r) => (r as { runId: string }).runId);
    byRun.set(runIds[0] as string, {
      events: [
        { type: "error", message: "boom" },
        { type: "finished", terminal: "failed", reason: "", text: "" },
      ],
      exitCode: 3,
    });

    await fx.runner.tick();
    for (const runId of runIds) await drain(runId);
    const rows = await Promise.all(runIds.map((id) => runRow(id)));
    expect(rows.map((r) => r.status)).toEqual(["failed", "failed"]);
    const errors = rows.map((r) => r.error).sort();
    expect(errors).toContain("boom");
    expect(errors).toContain("exit 5");
  });

  it("marks the step limit as partial", async () => {
    const fx = makeFixture({
      scriptFor: () => ({
        events: [{ type: "finished", terminal: "failed", reason: "stopped within 10 step(s)", text: "" }],
        exitCode: 1,
      }),
    });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    await drain(runId);
    const row = await runRow(runId);
    expect(row.status).toBe("partial");
    expect(row.error).toBe("step limit");
  });

  it("recovers orphaned runs and containers", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const started = await researchStart(handle.db, { companyIds: [a, b] });
    const [idA, idB] = started.runs.map((r) => (r as { runId: string }).runId);
    for (const [id, phase] of [
      [idA, "researching"],
      [idB, "collecting"],
    ] as const) {
      await handle.db
        .update(researchRuns)
        .set({ status: "running", agentPhase: phase, startedAt: new Date() })
        .where(eq(researchRuns.id, id as string));
    }
    const { token } = await issueRunToken(handle.db, { runId: idA as string, companyId: a, ttlMinutes: 60 });

    const recovered = await fx.runner.recover();
    expect(recovered.failedRuns.sort()).toEqual([idA, idB].sort());
    expect(recovered.stoppedContainers).toEqual(["container-1"]);
    expect(fx.stopLabeledCalls).toBe(1);
    expect((await runRow(idA as string)).status).toBe("failed");
    expect((await runRow(idA as string)).error).toBe("server restarted");
    expect(await authenticateRunToken(handle.db, token)).toBeNull();
  });

  it("recover spares running extraction subjobs for the company worker", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("A Co");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const [row] = await handle.db
      .insert(researchRuns)
      .values({
        id: randomUUID(),
        companyId,
        kind: "agent",
        status: "running",
        startedAt: new Date(),
        companyJobId: jobId,
        stage: "extraction",
      })
      .returning({ id: researchRuns.id });
    if (!row) throw new Error("no subjob row");
    const recovered = await fx.runner.recover();
    expect(recovered.failedRuns).toEqual([]);
    expect((await runRow(row.id)).status).toBe("running");
  });

  it("recover fails only running agent rows, whatever their stage", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const mk = async (name: string, status: "queued" | "running" | "succeeded", stage: "preflight" | "research" | null) => {
      const companyId = await makeCompany(name);
      const started = await researchStart(handle.db, { companyIds: [companyId] });
      const runId = (started.runs[0] as { runId: string }).runId;
      await handle.db.update(researchRuns).set({ status, stage }).where(eq(researchRuns.id, runId));
      return runId;
    };
    const queuedPreflight = await mk("A Co", "queued", "preflight");
    const doneResearch = await mk("B Co", "succeeded", "research");
    const runningResearch = await mk("C Co", "running", "research");
    const runningLegacy = await mk("D Co", "running", null);
    const recovered = await fx.runner.recover();
    expect(recovered.failedRuns.sort()).toEqual([runningResearch, runningLegacy].sort());
    expect((await runRow(queuedPreflight)).status).toBe("queued");
    expect((await runRow(doneResearch)).status).toBe("succeeded");
  });

  it("stores usage, session, exit and final message, skipping message deltas", async () => {
    const fx = makeFixture({
      scriptFor: () => ({
        events: [
          { type: "started", sessionId: "session-1" },
          { type: "message", text: "delta" },
          { type: "usage", ...USAGE },
          COMPLETED,
        ],
        finalMessage: "the end",
      }),
    });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId);

    await fx.runner.tick();
    await drain(runId);
    const row = await runRow(runId);
    expect(row.status).toBe("succeeded");
    expect(row.agentSessionId).toBe("session-1");
    expect(row.agentExitCode).toBe(0);
    expect(row.agentFinalMessage).toBe("the end");
    expect(row.agentUsage).toEqual({
      model: "fake-model",
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 50,
      reasoningTokens: 7,
      calls: 2,
      childrenIncluded: false,
    });
    const harnessRows = await handle.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(eq(runEvents.runId, runId));
    const kinds = harnessRows
      .map((r) => (r.payload as { type?: string }).type)
      .filter((t) => t !== undefined);
    expect(kinds).toEqual(["started", "usage", "finished"]);
  });

  it("logs the dispatch prompt and ingests the session after the run", async () => {
    const ingested: { runId: string; sessionId: string | undefined }[] = [];
    const fx = makeFixture({
      scriptFor: () => ({
        events: [{ type: "started", sessionId: "session-9" }, COMPLETED],
      }),
      sessionIngest: async (runId, sessionId) => {
        ingested.push({ runId, sessionId });
        return { calls: 3 };
      },
    });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId);

    await fx.runner.tick();
    await drain(runId);
    expect(ingested).toEqual([{ runId, sessionId: "session-9" }]);
    const [dispatch] = await handle.db.select().from(providerCalls).where(eq(providerCalls.runId, runId));
    expect(dispatch?.sessionId).toBe("session-9");
    expect(dispatch?.promptSha256).not.toBeNull();
    expect(dispatch?.stage).toBe("research");
    const [blob] = await handle.db.select().from(blobs).where(eq(blobs.sha256, dispatch?.promptSha256 ?? ""));
    expect(blob).toBeTruthy();
    expect(fx.prompts).toHaveLength(1);
  });

  it("writes raw stdout to events.jsonl", async () => {
    const fx = makeFixture({
      scriptFor: () => ({ events: [COMPLETED], rawLines: ['{"a":1}', "not json", '{"b":2}'] }),
    });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;
    await arrangeFinish(runId);

    await fx.runner.tick();
    await drain(runId);
    const content = readFileSync(join(runsDir, runId, "events.jsonl"), "utf8");
    expect(content).toBe('{"a":1}\nnot json\n{"b":2}\n');
  });

  it("fails loudly without a prompt builder", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }), buildPrompt: null });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const started = await researchStart(handle.db, { companyIds: [companyId] });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    await drain(runId);
    const row = await runRow(runId);
    expect(row.status).toBe("failed");
    expect(row.error ?? "").toMatch(/no prompt builder/);
  });

  it("claims company research subjobs straight to researching (no legacy collect)", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("A Co");
    // Deliberately no freshCollect: the pipeline's collect subjob owns
    // deterministic collection, so a research row must never run legacy
    // in-process collect even when no fresh collect exists.
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const started = await researchStart(handle.db, { companyIds: [companyId], companyJobId: jobId, stage: "research" });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    await drain(runId);
    expect(fx.harness.handles.has(runId)).toBe(true);
    expect(fx.collectCalls).toEqual([]);
    // COMPLETED with no run_finish: partial, not queued.
    expect((await runRow(runId)).status).toBe("partial");
  });

  it("claims company preflight subjobs without legacy collect either", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("P Co");
    // No freshCollect: without the company guard the row would run the full
    // legacy collect in-process before recon.
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const started = await researchStart(handle.db, { companyIds: [companyId], companyJobId: jobId, stage: "preflight" });
    const runId = (started.runs[0] as { runId: string }).runId;

    await fx.runner.tick();
    await drain(runId);
    expect(fx.harness.handles.has(runId)).toBe(true);
    expect(fx.collectCalls).toEqual([]);
  });

  it("drives preflight subjobs to succeeded on run_finish without area statuses", async () => {
    const fx = makeFixture({ scriptFor: () => ({ events: [COMPLETED] }) });
    const companyId = await makeCompany("A Co");
    await freshCollect(companyId);
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const started = await researchStart(handle.db, { companyIds: [companyId], companyJobId: jobId, stage: "preflight" });
    const runId = (started.runs[0] as { runId: string }).runId;
    await recordEvent(handle.db, runId, "agent_finish", { summary: "recon done" });

    await fx.runner.tick();
    await drain(runId);
    expect(fx.harness.handles.has(runId)).toBe(true);
    expect((await runRow(runId)).status).toBe("succeeded");
  });
});

describe("pruneRunDirs", () => {
  it("deletes run dirs older than the keep window, sparing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "prune-test-"));
    try {
      const oldDir = join(dir, "old-run");
      const newDir = join(dir, "new-run");
      mkdirSync(oldDir);
      mkdirSync(newDir);
      const oldFile = join(dir, "keep.txt");
      writeFileSync(oldFile, "spared");
      const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      utimesSync(oldDir, past, past);
      utimesSync(oldFile, past, past);

      const pruned = pruneRunDirs(dir, 7);
      expect(pruned).toEqual(["old-run"]);
      expect(existsSync(oldFile)).toBe(true);
      expect(existsSync(newDir)).toBe(true);
      expect(existsSync(oldDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
