import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { startServer, type ServerHandle } from "../../src/server.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";
import { sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";

// An agent shift, end to end, driving only MCP tools (the harness uses the DB
// solely to reset between runs and to boot the server).
// Flow: registry_list → company_add → company_context → source_fetch (fake site)
// → fact_add + record_upsert + document_save + finding_add → ad-hoc key and
// type without registering → reviews_ingest 20 → source_capture via browser →
// area_status_set → search finds the data.

const TOKEN = "test-operator-token";

interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

let handle: DbHandle;
let server: ServerHandle;
let client: Client;
let site: FakeSite;
let previousAllowlist: string | undefined;

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
  await resetTestDb(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: TOKEN });
  client = new Client({ name: "agent-style-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  previousAllowlist = process.env.KARDATA_PRIVATE_HOST_ALLOWLIST;
  process.env.KARDATA_PRIVATE_HOST_ALLOWLIST = "127.0.0.1";
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) =>
    sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"),
  );
  site.routes.set("/", (_req, res) =>
    sendText(
      res,
      "<html><head><title>Glowlab</title></head><body><p>Glowlab vitamin serum, twelve products.</p></body></html>",
    ),
  );
});

afterAll(async () => {
  await site.close();
  if (previousAllowlist === undefined) delete process.env.KARDATA_PRIVATE_HOST_ALLOWLIST;
  else process.env.KARDATA_PRIVATE_HOST_ALLOWLIST = previousAllowlist;
  await client.close();
  await server.close();
  await handle.close();
});

describe("agent shift", () => {
  it("researches a company through tools alone", async () => {
    const registry = dataOf(await call("registry_list", {}));
    expect((registry.factKeys as unknown[]).length).toBeGreaterThan(0);

    const sector = dataOf(await call("sector_create", { name: "Agent Sector" }));
    const sectorId = (sector.sector as { id: string }).id;
    const added = dataOf(await call("company_add", { sectorId, name: "Glowlab" }));
    const companyId = (added.company as { id: string }).id;

    const empty = dataOf(await call("company_context", { companyId }));
    expect((empty.facts as unknown[])).toHaveLength(0);

    const fetched = dataOf(await call("source_fetch", { companyId, url: `${site.baseUrl}/` }));
    expect(fetched.text).toContain("twelve products");
    const sourceId = fetched.sourceId as string;
    const runId = fetched.runId as string;

    const facts = dataOf(
      await call("fact_add", {
        companyId,
        runId,
        facts: [{ key: "product.count", value: 12, sourceIds: [sourceId], confidence: "high" }],
      }),
    );
    const factId = ((facts.results as { id: string }[])[0] as { id: string }).id;

    const upserted = dataOf(
      await call("record_upsert", {
        companyId,
        runId,
        records: [
          {
            type: "product",
            data: { name: "Vitamin serum", url: `${site.baseUrl}/products/serum`, price: 24 },
            sourceIds: [sourceId],
          },
        ],
      }),
    );
    const recordId = ((upserted.results as { id: string }[])[0] as { id: string }).id;

    const saved = dataOf(
      await call("document_save", {
        companyId,
        runId,
        path: "product/glowlab-notes.md",
        title: "Glowlab notes",
        content: "# Glowlab\n\nVitamin serum leads the twelve-product line.",
        sourceIds: [sourceId],
        factIds: [factId],
        recordIds: [recordId],
      }),
    );
    expect(saved.outcome).toBe("created");

    const found = dataOf(
      await call("finding_add", {
        companyId,
        runId,
        area: "product",
        claim: "Serum-led twelve-product line",
        sourceIds: [sourceId],
        factIds: [factId],
        confidence: "high",
        status: "supported",
      }),
    );
    expect(typeof found.id).toBe("string");

    // Ad-hoc key and type, no register calls: accepted with warnings.
    const adHocFact = dataOf(
      await call("fact_add", {
        companyId,
        runId,
        facts: [{ key: "packaging.refill_stations", value: 3, sourceIds: [sourceId] }],
      }),
    );
    const factWarnings = ((adHocFact.results as { warnings: string[] }[])[0] as { warnings: string[] }).warnings;
    expect(factWarnings.join(" ")).toContain("provisional");
    const adHocRecord = dataOf(
      await call("record_upsert", {
        companyId,
        runId,
        records: [
          { type: "refill_station", data: { location: "Soho", units: 2 }, sourceIds: [sourceId] },
        ],
      }),
    );
    const recordWarnings = ((adHocRecord.results as { warnings: string[] }[])[0] as { warnings: string[] }).warnings;
    expect(recordWarnings.join(" ")).toContain("provisional");

    const ingested = dataOf(
      await call("reviews_ingest", {
        companyId,
        runId,
        platform: "testplatform",
        sourceId,
        reviews: Array.from({ length: 20 }, (_, i) => ({
          text: `glowing review number ${i} about the serum`,
          rating: 5,
          date: "2026-09-10",
          reviewer_name: `Reviewer ${i}`,
        })),
      }),
    );
    expect((ingested.results as unknown[])).toHaveLength(20);
    expect(ingested.recomputed).toContain("reviews.ingested_count");

    const captured = dataOf(
      await call("source_capture", {
        companyId,
        runId,
        url: "https://example.invalid/glowlab-profile",
        title: "Glowlab profile",
        text: "Glowlab profile seen in the browser.",
        via: "browser",
      }),
    );
    expect(typeof captured.sourceId).toBe("string");

    const status = dataOf(await call("area_status_set", { runId, area: "product", status: "done" }));
    expect(status.status).toBe("done");

    const search = dataOf(await call("search", { query: "glowing serum", companyId }));
    const kinds = (search.hits as { kind: string }[]).map((h) => h.kind);
    expect(kinds).toContain("record");
    const docSearch = dataOf(await call("search", { query: "twelve-product", companyId }));
    expect((docSearch.hits as { kind: string }[]).map((h) => h.kind)).toContain("document");

    const context = dataOf(await call("company_context", { companyId }));
    expect((context.facts as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(context).length).toBeLessThan(10 * 1024);
  });
});
