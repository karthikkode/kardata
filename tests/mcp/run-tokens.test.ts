import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { blobs, documents, facts, researchRuns, runEvents, runTokens } from "../../src/db/schema.js";
import { startServer, type ServerHandle } from "../../src/server.js";
import { hashRunToken, issueRunToken, revokeRunToken } from "../../src/runs/tokens.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const TOKEN = "test-run-token-operator";

interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

let handle: DbHandle;
let server: ServerHandle;
let operator: Client;
const agentClients: Client[] = [];

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

async function makeAgentRun(companyId: string, status: "running" | "succeeded" = "running"): Promise<string> {
  const runId = randomUUID();
  await handle.db.insert(researchRuns).values({
    id: runId,
    companyId,
    kind: "agent",
    status,
    createdBy: "owner",
    startedAt: new Date(),
  });
  return runId;
}

async function agentClientFor(runId: string, companyId: string, ttlMinutes = 60): Promise<{ client: Client; token: string }> {
  const { token } = await issueRunToken(handle.db, { runId, companyId, ttlMinutes });
  const client = new Client({ name: "stage-3b-step-1-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  agentClients.push(client);
  return { client, token };
}

async function mcpCalls(runId: string): Promise<{ tool: string; status: string; args: string }[]> {
  const rows = await handle.db
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "mcp_call")));
  return rows.map((r) => (r.payload ?? {}) as unknown as { tool: string; status: string; args: string });
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: TOKEN });
  operator = new Client({ name: "stage-3b-step-1-operator", version: "1.0.0" });
  await operator.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
});

beforeEach(async () => {
  await resetTestDb(handle);
});

afterEach(async () => {
  for (const client of agentClients.splice(0)) await client.close();
});

afterAll(async () => {
  await operator.close();
  await server.close();
  await handle.close();
});

describe("run tokens", () => {
  it("scope reads to the token's company", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const runId = await makeAgentRun(a);
    const { client } = await agentClientFor(runId, a);

    const own = await call(client, "company_context", { companyId: a });
    expect(own.isError).not.toBe(true);
    expect(errorOf(await call(client, "company_context", { companyId: b })).code).toBe("forbidden");
    expect(errorOf(await call(client, "facts_get", { companyId: b })).code).toBe("forbidden");
  });

  it("rejects operator tools, and audits the attempt", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a);
    const { client } = await agentClientFor(runId, a);

    expect(errorOf(await call(client, "sector_list", {})).code).toBe("forbidden");
    expect(errorOf(await call(client, "note_add", { companyId: a, area: "product", title: "t", content: "c" })).code).toBe(
      "forbidden",
    );
    expect(errorOf(await call(client, "collect_start", { companyIds: [a] })).code).toBe("forbidden");

    const calls = await mcpCalls(runId);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => [c.tool, c.status])).toEqual([
      ["sector_list", "forbidden"],
      ["note_add", "forbidden"],
      ["collect_start", "forbidden"],
    ]);
  });

  it("rejects revoked and expired tokens with 401", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a);
    const { client, token } = await agentClientFor(runId, a);
    expect((await call(client, "company_context", { companyId: a })).isError).not.toBe(true);

    await revokeRunToken(handle.db, runId);
    await expect(call(client, "company_context", { companyId: a })).rejects.toThrow(/unauthorized/);

    const runId2 = await makeAgentRun(a, "succeeded");
    const short = await agentClientFor(runId2, a, 60);
    void token;
    // Expire without waiting: backdate past now.
    await handle.db
      .update(runTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(runTokens.tokenHash, hashRunToken(short.token)));
    await expect(call(short.client, "company_context", { companyId: a })).rejects.toThrow(/unauthorized/);
  });

  it("audits every run-token call with tool, args, status and duration", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a);
    const { client } = await agentClientFor(runId, a);

    await call(client, "company_context", { companyId: a });
    await call(client, "company_context", { companyId: randomUUID() });

    const rows = await handle.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "mcp_call")));
    expect(rows).toHaveLength(2);
    const first = rows[0]?.payload as unknown as Record<string, unknown>;
    expect(first.tool).toBe("company_context");
    expect(first.status).toBe("ok");
    expect(first.args as string).toContain(a);
    expect((first.args as string).length).toBeLessThanOrEqual(2048);
    expect(typeof first.durationMs).toBe("number");
    expect((rows[1]?.payload as unknown as Record<string, unknown>).status).toBe("forbidden");
  });

  it("audits result size and a result blob ref per call", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a);
    const { client } = await agentClientFor(runId, a);

    await call(client, "company_context", { companyId: a });
    const rows = await handle.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "mcp_call")));
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as unknown as Record<string, unknown>;
    expect(payload.status).toBe("ok");
    expect(typeof payload.resultSize).toBe("number");
    expect((payload.resultSize as number)).toBeGreaterThan(0);
    expect(payload.resultTruncated).toBe(false);
    if (payload.resultSha === null) {
      expect(payload.result as string).toContain("company");
    } else {
      const [blob] = await handle.db.select().from(blobs).where(eq(blobs.sha256, payload.resultSha as string));
      if (!blob) throw new Error("audit blob missing");
      expect(gunzipSync(blob.gzip).toString("utf8")).toContain("company");
    }
  });

  it("forces run_id and company from the token, never arguments", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const runId = await makeAgentRun(a);
    const otherRun = await makeAgentRun(a, "succeeded");
    const { client } = await agentClientFor(runId, a);

    const captured = dataOf(
      await call(client, "source_capture", {
        companyId: a,
        url: "https://example.com/x",
        text: "hello",
        via: "browser",
        passages: ["hello"],
      }),
    );
    const sourceId = captured.sourceId as string;

    const written = dataOf(
      await call(client, "fact_add", {
        companyId: a,
        facts: [{ key: "product.name", value: "X", sourceIds: [sourceId] }],
      }),
    );
    expect((written.results as { ok: boolean }[])[0]?.ok).toBe(true);
    const [fact] = await handle.db.select().from(facts).where(eq(facts.companyId, a));
    expect(fact?.runId).toBe(runId);

    expect(
      errorOf(
        await call(client, "fact_add", {
          companyId: b,
          facts: [{ key: "product.name", value: "Y", sourceIds: [sourceId] }],
        }),
      ).code,
    ).toBe("forbidden");
    expect(
      errorOf(
        await call(client, "fact_add", {
          companyId: a,
          runId: otherRun,
          facts: [{ key: "product.name", value: "Y", sourceIds: [sourceId] }],
        }),
      ).code,
    ).toBe("forbidden");
  });

  it("attributes writes with and without a label", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a);
    const { client } = await agentClientFor(runId, a);
    const captured = dataOf(
      await call(client, "source_capture", {
        companyId: a,
        url: "https://example.com/x",
        text: "hello",
        via: "browser",
        passages: ["hello"],
      }),
    );
    const sourceId = captured.sourceId as string;

    await call(client, "fact_add", {
      companyId: a,
      agentLabel: "reviews",
      facts: [{ key: "product.name", value: "L", sourceIds: [sourceId] }],
    });
    await call(client, "fact_add", {
      companyId: a,
      facts: [{ key: "product.tagline", value: "M", sourceIds: [sourceId] }],
    });
    const rows = await handle.db.select().from(facts).where(eq(facts.companyId, a));
    const by = Object.fromEntries(rows.map((r) => [r.key, r.createdBy]));
    expect(by["product.name"]).toBe(`agent:${runId}/reviews`);
    expect(by["product.tagline"]).toBe(`agent:${runId}/main`);

    await call(client, "document_save", {
      companyId: a,
      agentLabel: "hiring",
      path: "hiring/notes.md",
      content: "# notes",
    });
    const [doc] = await handle.db.select().from(documents).where(eq(documents.companyId, a));
    expect(doc?.createdBy).toBe(`agent:${runId}/hiring`);
    expect(doc?.runId).toBe(runId);
  });

  it("enforces company scope on id-based reads", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const runId = await makeAgentRun(a);
    const { client } = await agentClientFor(runId, a);

    const saved = dataOf(
      await call(operator, "document_save", { companyId: b, path: "product/b.md", content: "# b" }),
    );
    const documentId = (saved as { id: string }).id;
    expect(errorOf(await call(client, "document_get", { documentId })).code).toBe("forbidden");
    expect(errorOf(await call(client, "document_history", { documentId })).code).toBe("forbidden");

    const captured = dataOf(
      await call(operator, "source_capture", {
        companyId: b,
        url: "https://example.com/b",
        text: "b text",
        via: "browser",
        passages: ["b text"],
      }),
    );
    expect(errorOf(await call(client, "source_get", { sourceId: captured.sourceId as string })).code).toBe(
      "forbidden",
    );
  });

  it("scopes search to the token's company", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const runId = await makeAgentRun(a);
    const { client } = await agentClientFor(runId, a);
    await call(operator, "document_save", { companyId: a, path: "product/a.md", title: "Alpha doc", content: "quetzal alpha" });
    await call(operator, "document_save", { companyId: b, path: "product/b.md", title: "Beta doc", content: "quetzal beta" });

    expect(errorOf(await call(client, "search", { query: "quetzal", companyId: b })).code).toBe("forbidden");
    const hits = dataOf(await call(client, "search", { query: "quetzal" }));
    const titles = (hits.hits as { title: string }[]).map((h) => h.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some((t) => t.includes("Alpha"))).toBe(true);
    expect(titles.some((t) => t.includes("Beta"))).toBe(false);
  });

  it("defaults area_status_set and run_finish to the caller's run", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a, "succeeded");
    const otherRun = await makeAgentRun(a, "succeeded");
    const { client } = await agentClientFor(runId, a);

    const status = dataOf(await call(client, "area_status_set", { area: "hiring", status: "done" }));
    expect(status.runId).toBe(runId);
    expect(errorOf(await call(client, "area_status_set", { runId: otherRun, area: "hiring", status: "done" })).code).toBe(
      "forbidden",
    );
    expect(errorOf(await call(operator, "area_status_set", { area: "hiring", status: "done" })).code).toBe(
      "invalid_input",
    );

    const finished = dataOf(
      await call(client, "run_finish", {
        summary: "done probing",
        areaOutcomes: [{ area: "hiring", status: "done" }],
      }),
    );
    expect(finished.runId).toBe(runId);
    const [event] = await handle.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "agent_finish")));
    expect(event?.payload).toMatchObject({ summary: "done probing" });
    expect(errorOf(await call(operator, "run_finish", { summary: "x" })).code).toBe("invalid_input");
  });

  it("leaves the operator unaffected: owner attribution, no audit", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a);
    await agentClientFor(runId, a);

    const captured = dataOf(
      await call(operator, "source_capture", {
        companyId: a,
        url: "https://example.com/o",
        text: "o text",
        via: "browser",
        passages: ["o text"],
      }),
    );
    await call(operator, "fact_add", {
      companyId: a,
      agentLabel: "ignored",
      facts: [{ key: "product.name", value: "O", sourceIds: [captured.sourceId as string] }],
    });
    const [fact] = await handle.db.select().from(facts).where(eq(facts.companyId, a));
    expect(fact?.createdBy).toBe("owner");

    const audits = await handle.db
      .select({ id: runEvents.id })
      .from(runEvents)
      .where(eq(runEvents.type, "mcp_call"));
    expect(audits).toHaveLength(0);
  });

  it("validates token issuance", async () => {
    const a = await makeCompany("A Co");
    const runId = await makeAgentRun(a);
    await expect(issueRunToken(handle.db, { runId: randomUUID(), companyId: a, ttlMinutes: 60 })).rejects.toThrow(
      /run not found/,
    );
    await expect(issueRunToken(handle.db, { runId, companyId: randomUUID(), ttlMinutes: 60 })).rejects.toThrow(
      /another company/,
    );
    await expect(issueRunToken(handle.db, { runId, companyId: a, ttlMinutes: 0 })).rejects.toThrow(
      /ttlMinutes/,
    );
  });
});
