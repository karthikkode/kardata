import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { startServer, type ServerHandle } from "../../src/server.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

const TOKEN = "test-operator-token";

interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

let handle: DbHandle;
let server: ServerHandle;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args });
  return result as unknown as ToolResult;
}

function dataOf(result: ToolResult): Record<string, unknown> {
  if (result.isError) throw new Error(`tool failed: ${JSON.stringify(result.structuredContent)}`);
  return result.structuredContent ?? {};
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: TOKEN });
  client = new Client({ name: "scorecard-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
});

beforeEach(async () => {
  await resetTestDb(handle);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await handle.close();
});

describe("batch_scorecard", () => {
  it("scores a collect batch end to end", async () => {
    const sector = dataOf(await call("sector_create", { name: "Score" }));
    const sectorId = (sector.sector as { id: string }).id;
    const created = dataOf(await call("company_add", { sectorId, name: "Score Co" }));
    const companyId = (created.company as { id: string }).id;
    const batch = dataOf(await call("collect_start", { companyIds: [companyId] }));
    const batchId = batch.batchId as string;
    const card = dataOf(await call("batch_scorecard", { batchId }));
    const totals = card.totals as { runs: number; facts: number };
    expect(totals.runs).toBe(1);
    expect(totals.facts).toBe(0);
    const runs = card.runs as { runId: string; status: string }[];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("queued");
    const missing = await call("batch_scorecard", { batchId: "00000000-0000-0000-0000-000000000000" });
    expect(missing.isError).toBe(true);
  });
});
