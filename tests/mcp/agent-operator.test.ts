import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { recordEvent } from "../../src/collect/db.js";
import type { DbHandle } from "../../src/db/client.js";
import { researchRuns } from "../../src/db/schema.js";
import type {
  AgentHarness,
  HarnessEvent,
  HarnessHandle,
  HarnessStartOptions,
  HarnessWaitResult,
} from "../../src/harness/types.js";
import { createAgentRunner, type AgentRunner } from "../../src/runs/agent-runner.js";
import { issueRunToken } from "../../src/runs/tokens.js";
import { startServer, type ServerHandle } from "../../src/server.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const TOKEN = "test-agent-operator-token";

interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

let handle: DbHandle;
let server: ServerHandle;
let operator: Client;
const extraClients: Client[] = [];
let runner: AgentRunner | null = null;
let runsDir = "";

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args });
  return result as unknown as ToolResult;
}

function dataOf(result: ToolResult): Record<string, unknown> {
  if (result.isError) throw new Error(`tool failed: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent ?? {};
}

function errorOf(result: ToolResult): { code: string; message: string } {
  expect(result.isError).toBe(true);
  return result.structuredContent as unknown as { code: string; message: string };
}

async function makeCompany(name: string): Promise<string> {
  const sector = dataOf(await call(operator, "sector_create", { name: `Sector for ${name}` }));
  const sectorId = (sector.sector as { id: string }).id;
  const created = dataOf(await call(operator, "company_add", { sectorId, name }));
  return (created.company as { id: string }).id;
}

async function agentClient(companyId: string, runId: string): Promise<Client> {
  const { token } = await issueRunToken(handle.db, { runId, companyId, ttlMinutes: 60 });
  const client = new Client({ name: "agent-operator-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  extraClients.push(client);
  return client;
}

class HangHandle implements HarnessHandle {
  stopped: string | null = null;
  readonly events: AsyncIterable<HarnessEvent> = {
    [Symbol.asyncIterator]: async function* () {},
  };
  private gate: Promise<void>;
  private release!: () => void;

  constructor() {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  async stop(reason: string): Promise<void> {
    this.stopped = reason;
    this.release();
  }

  async wait(): Promise<HarnessWaitResult> {
    await this.gate;
    return { exitCode: 0, finalMessage: "", usage: undefined };
  }
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: TOKEN });
  operator = new Client({ name: "agent-operator-operator", version: "1.0.0" });
  await operator.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
});

beforeEach(async () => {
  await resetTestDb(handle);
  runsDir = mkdtempSync(join(tmpdir(), "agent-operator-test-"));
});

afterEach(async () => {
  if (runner) {
    await runner.stop();
    runner = null;
  }
  for (const client of extraClients.splice(0)) await client.close();
  rmSync(runsDir, { recursive: true, force: true });
});

afterAll(async () => {
  await operator.close();
  await server.close();
  await handle.close();
});

describe("agent operator tools", () => {
  it("starts batches, reports already_running, and validates input", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const batch = dataOf(
      await call(operator, "research_start", {
        companyIds: [a, b],
        maxMinutes: 10,
        brief: "hello",
      }),
    );
    expect(batch.batchId).toBeTruthy();
    const runs = batch.runs as { companyId: string; runId: string; status: string }[];
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.status)).toEqual(["queued", "queued"]);

    const again = dataOf(await call(operator, "research_start", { companyIds: [a] }));
    expect((again.runs as { status: string }[])[0]?.status).toBe("already_running");

    expect(errorOf(await call(operator, "research_start", { companyIds: [] })).code).toBe(
      "invalid_input",
    );
    expect(
      errorOf(await call(operator, "research_start", { companyIds: [a], areas: ["nope"] })).code,
    ).toBe("invalid_input");
    expect(
      errorOf(await call(operator, "research_start", { companyIds: [a], brief: "x".repeat(3000) })).code,
    ).toBe("invalid_input");

    const detail = dataOf(await call(operator, "run_get", { runId: runs[0]?.runId as string }));
    const run = detail.run as { kind: string; agentOptions: Record<string, unknown> };
    expect(run.kind).toBe("agent");
    expect(run.agentOptions).toMatchObject({ maxMinutes: 10, brief: "hello" });
  });

  it("keeps research_start and run_activity operator-only", async () => {
    const a = await makeCompany("A Co");
    const batch = dataOf(await call(operator, "research_start", { companyIds: [a] }));
    const runId = (batch.runs as { runId: string }[])[0]?.runId as string;
    const agent = await agentClient(a, runId);
    expect(errorOf(await call(agent, "research_start", { companyIds: [a] })).code).toBe("forbidden");
    expect(errorOf(await call(agent, "run_activity", { runId })).code).toBe("forbidden");
  });

  it("reports batch counts, phases, minutes, tokens and items", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const batch = dataOf(await call(operator, "research_start", { companyIds: [a, b] }));
    const batchId = batch.batchId as string;
    const runs = batch.runs as { companyId: string; runId: string }[];
    const runA = runs.find((r) => r.companyId === a)?.runId as string;
    const usage = {
      model: "m",
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 500,
      reasoningTokens: 50,
      calls: 4,
      childrenIncluded: false,
    };
    await handle.db
      .update(researchRuns)
      .set({
        status: "running",
        agentPhase: "researching",
        agentUsage: usage,
        startedAt: new Date(Date.now() - 5 * 60_000),
      })
      .where(eq(researchRuns.id, runA));

    const captured = dataOf(
      await call(operator, "source_capture", {
        companyId: a,
        runId: runA,
        url: "https://example.com/x",
        text: "x",
        via: "browser",
      }),
    );
    await call(operator, "fact_add", {
      companyId: a,
      runId: runA,
      facts: [{ key: "product.name", value: "X", sourceIds: [captured.sourceId as string] }],
    });
    await call(operator, "document_save", {
      companyId: a,
      runId: runA,
      path: "product/x.md",
      content: "# x",
    });

    const status = dataOf(await call(operator, "batch_status", { batchId }));
    expect(status.counts).toEqual({ running: 1, queued: 1 });
    expect(status.phases).toEqual({ researching: 1 });
    const lines = status.runs as Record<string, unknown>[];
    const lineA = lines.find((l) => l.runId === runA) as Record<string, unknown>;
    expect(lineA.phase).toBe("researching");
    expect(lineA.minutes as number).toBeGreaterThan(4);
    expect(lineA.minutes as number).toBeLessThan(6);
    expect(lineA.tokens).toEqual(usage);
    expect(lineA.items).toEqual({ facts: 1, records: 0, documents: 1, findings: 0 });
    const lineB = lines.find((l) => l.runId !== runA) as Record<string, unknown>;
    expect(lineB.phase).toBeNull();
    expect(lineB.tokens).toBeNull();
    expect(lineB.items).toEqual({ facts: 0, records: 0, documents: 0, findings: 0 });
  });

  it("extends run_get with written items", async () => {
    const a = await makeCompany("A Co");
    const batch = dataOf(await call(operator, "research_start", { companyIds: [a] }));
    const runId = (batch.runs as { runId: string }[])[0]?.runId as string;
    await handle.db
      .update(researchRuns)
      .set({ status: "running", agentPhase: "researching", startedAt: new Date() })
      .where(eq(researchRuns.id, runId));
    const captured = dataOf(
      await call(operator, "source_capture", {
        companyId: a,
        runId,
        url: "https://example.com/x",
        text: "x",
        via: "browser",
      }),
    );
    await call(operator, "fact_add", {
      companyId: a,
      runId,
      facts: [{ key: "product.name", value: "X", sourceIds: [captured.sourceId as string] }],
    });

    const detail = dataOf(await call(operator, "run_get", { runId }));
    const run = detail.run as { agentPhase: string };
    expect(run.agentPhase).toBe("researching");
    expect(detail.items).toEqual({ facts: 1, records: 0, documents: 0, findings: 0 });
  });

  it("merges harness and audit events in run_activity", async () => {
    const a = await makeCompany("A Co");
    const batch = dataOf(await call(operator, "research_start", { companyIds: [a] }));
    const runId = (batch.runs as { runId: string }[])[0]?.runId as string;
    await recordEvent(handle.db, runId, "harness", { type: "started" });
    await recordEvent(handle.db, runId, "log", { skip: true });
    await recordEvent(handle.db, runId, "mcp_call", { tool: "company_context" });
    await recordEvent(handle.db, runId, "phase", { phase: "researching" });
    await recordEvent(handle.db, runId, "harness", { type: "finished" });

    const all = dataOf(await call(operator, "run_activity", { runId }));
    const events = all.events as { id: number; type: string }[];
    expect(events.map((e) => e.type)).toEqual(["harness", "mcp_call", "harness"]);
    expect(events[0]?.id as number).toBeLessThan(events[1]?.id as number);

    const after = dataOf(await call(operator, "run_activity", { runId, afterId: events[0]?.id as number }));
    expect((after.events as unknown[])).toHaveLength(2);
    const limited = dataOf(await call(operator, "run_activity", { runId, limit: 1 }));
    expect((limited.events as unknown[])).toHaveLength(1);
    expect(errorOf(await call(operator, "run_activity", { runId, limit: 0 })).code).toBe("invalid_input");
    expect(errorOf(await call(operator, "run_activity", { runId: randomUUID() })).code).toBe("not_found");
  });

  it("run_cancel stops a researching run", async () => {
    const handles = new Map<string, HangHandle>();
    const harness: AgentHarness = {
      start: (opts: HarnessStartOptions) => {
        const h = new HangHandle();
        handles.set(opts.runId, h);
        return h;
      },
    };
    runner = createAgentRunner(handle.db, {
      harness,
      mcpUrl: "http://host.docker.internal:9999/mcp",
      pollMs: 60_000,
      runsDir,
      buildPrompt: () => "fake prompt",
      collect: async () => {
        throw new Error("collect must be skipped");
      },
    });
    const a = await makeCompany("A Co");
    await handle.db.insert(researchRuns).values({
      id: randomUUID(),
      companyId: a,
      kind: "collect",
      status: "succeeded",
      createdBy: "owner",
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const batch = dataOf(await call(operator, "research_start", { companyIds: [a] }));
    const runId = (batch.runs as { runId: string }[])[0]?.runId as string;

    await runner.tick();
    const deadline = Date.now() + 10_000;
    while (!handles.has(runId)) {
      if (Date.now() > deadline) throw new Error("harness never started");
      await new Promise((r) => setTimeout(r, 25));
    }
    const cancelled = dataOf(await call(operator, "run_cancel", { runId }));
    expect((cancelled.run as { status: string }).status).toBe("cancelled");
    await runner.tick();
    expect(handles.get(runId)?.stopped).toBe("cancelled");
    for (;;) {
      const [row] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runId));
      if (row?.status === "cancelled") break;
      if (Date.now() > deadline) throw new Error("run never settled");
      await new Promise((r) => setTimeout(r, 25));
    }
  });
});
