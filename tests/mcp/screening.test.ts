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
  client = new Client({ name: "screening-test", version: "1.0.0" });
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

async function makeSectorWithCompanies(name: string, count: number): Promise<{ sectorId: string; ids: string[] }> {
  const sector = dataOf(await call("sector_create", { name }));
  const sectorId = (sector.sector as { id: string }).id;
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const created = dataOf(
      await call("company_add", { sectorId, name: `${name} Co ${i}`, country: i % 2 === 0 ? "Canada" : "Japan" }),
    );
    ids.push((created.company as { id: string }).id);
  }
  return { sectorId, ids };
}

describe("step 0 tools", () => {
  it("collect_sector queues the sector", async () => {
    const { sectorId } = await makeSectorWithCompanies("Collect", 3);
    const first = dataOf(await call("collect_sector", { sectorId }));
    expect(first.queued).toBe(3);
    expect((first.batchIds as string[])).toHaveLength(1);
    const again = dataOf(await call("collect_sector", { sectorId }));
    expect(again.queued).toBe(0);
    expect(again.alreadyRunning).toBe(3);
  });

  it("company_screen filters and returns ids", async () => {
    const { sectorId, ids } = await makeSectorWithCompanies("Screen", 4);
    const result = dataOf(
      await call("company_screen", {
        sectorId,
        criteria: [{ field: "country", op: "eq", value: "Canada" }],
      }),
    );
    expect(result.total).toBe(2);
    expect((result.ids as string[]).sort()).toEqual([ids[0], ids[2]].sort());
    const items = result.items as { matched: Record<string, unknown[]> }[];
    expect(items[0]?.matched["0"]).toEqual(["Canada"]);
  });

  it("shortlists round-trip", async () => {
    const { sectorId, ids } = await makeSectorWithCompanies("Short", 2);
    const saved = dataOf(await call("shortlist_save", { sectorId, name: "top", companyIds: ids }));
    expect(saved.name).toBe("top");
    const got = dataOf(await call("shortlist_get", { sectorId, name: "top" }));
    expect(got.companyIds).toEqual(ids);
    const lists = dataOf(await call("shortlist_list", { sectorId }));
    expect(lists.shortlists).toHaveLength(1);
  });
});
