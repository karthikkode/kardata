import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { recordEvent } from "../../src/collect/db.js";
import { startServer, type ServerHandle } from "../../src/server.js";
import {
  ensureMigrated,
  fixtureCsvPath,
  fixtureImportDirs,
  getTestDb,
  resetTestDb,
} from "../db.js";
import { sendText, startFakeSite, type FakeSite } from "../collect/fake-site.js";

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
let previousImportDirs: string | undefined;
let previousAllowlist: string | undefined;

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
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
  const sector = dataOf(await call("sector_create", { name: `Sector for ${name}` }));
  const sectorId = (sector.sector as { id: string }).id;
  const created = dataOf(await call("company_add", { sectorId, name }));
  return (created.company as { id: string }).id;
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: TOKEN });
  client = new Client({ name: "stage-2-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  previousImportDirs = process.env.KARDATA_IMPORT_DIRS;
  process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
  previousAllowlist = process.env.KARDATA_PRIVATE_HOST_ALLOWLIST;
  process.env.KARDATA_PRIVATE_HOST_ALLOWLIST = "127.0.0.1";
});

beforeEach(async () => {
  await resetTestDb(handle);
  site = await startFakeSite();
  site.routes.set("/robots.txt", (_req, res) =>
    sendText(res, "User-agent: *\nDisallow:\n", 200, "text/plain"),
  );
  site.routes.set("/", (_req, res) =>
    sendText(res, "<html><head><title>Fake</title></head><body><p>Visible words here.</p></body></html>"),
  );
});

afterEach(async () => {
  await site.close();
});

afterAll(async () => {
  if (previousImportDirs === undefined) delete process.env.KARDATA_IMPORT_DIRS;
  else process.env.KARDATA_IMPORT_DIRS = previousImportDirs;
  if (previousAllowlist === undefined) delete process.env.KARDATA_PRIVATE_HOST_ALLOWLIST;
  else process.env.KARDATA_PRIVATE_HOST_ALLOWLIST = previousAllowlist;
  await client.close();
  await server.close();
  await handle.close();
});

describe("run tools", () => {
  it("starts, describes, pages events for and cancels runs", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const started = dataOf(await call("collect_start", { companyIds: [a, b], areas: ["hiring"] }));
    const batchId = started.batchId as string;
    const runs = started.runs as { runId: string; status: string }[];
    expect(runs).toHaveLength(2);

    const again = dataOf(await call("collect_start", { companyIds: [a] }));
    expect((again.runs as { status: string }[])[0]?.status).toBe("already_running");

    const status = dataOf(await call("batch_status", { batchId }));
    expect(status.counts).toEqual({ queued: 2 });

    const runId = runs[0]?.runId as string;
    await recordEvent(handle.db, runId, "log", { message: "hi" });
    const detail = dataOf(await call("run_get", { runId }));
    expect((detail.run as { status: string }).status).toBe("queued");
    const events = dataOf(await call("run_events", { runId, limit: 200 }));
    expect((events.events as unknown[]).length).toBeGreaterThan(0);
    const capped = await call("run_events", { runId, limit: 201 });
    expect(errorOf(capped).code).toBe("invalid_input");

    const cancelled = dataOf(await call("run_cancel", { runId }));
    expect((cancelled.run as { status: string }).status).toBe("cancelled");
    const missing = await call("batch_status", { batchId: "00000000-0000-0000-0000-000000000000" });
    expect(errorOf(missing).code).toBe("not_found");
  });
});

describe("registry tools", () => {
  it("lists, describes and curates", async () => {
    const full = dataOf(await call("registry_list", {}));
    expect((full.factKeys as unknown[]).length).toBeGreaterThanOrEqual(29);
    const filtered = dataOf(await call("registry_list", { area: "reviews" }));
    const names = (filtered.factKeys as { key: string }[]).map((k) => k.key);
    expect(names).toContain("reviews.avg_rating");
    expect(names).not.toContain("product.count");

    const companyId = await makeCompany("Reg Co");
    const fetched = dataOf(await call("source_fetch", { companyId, url: `${site.baseUrl}/` }));
    const sourceId = fetched.sourceId as string;
    const added = dataOf(
      await call("fact_add", {
        companyId,
        facts: [{ key: "test.curated_thing", value: 1, sourceIds: [sourceId] }],
      }),
    );
    expect(((added.results as { ok: boolean }[])[0]?.ok)).toBe(true);
    const described = dataOf(
      await call("registry_describe", { name: "test.curated_thing", description: "A curated thing" }),
    );
    expect(described.kind).toBe("fact_key");
    const curated = dataOf(await call("registry_curate", { name: "test.curated_thing", approve: true }));
    expect((curated.result as { status: string }).status).toBe("approved");
  });
});

describe("ingest and document tools", () => {
  it("fetches, captures, writes and reads back", async () => {
    const companyId = await makeCompany("Doc Co");
    const fetched = dataOf(await call("source_fetch", { companyId, url: `${site.baseUrl}/` }));
    expect(fetched.status).toBe("ok");
    expect(fetched.text).toContain("Visible words here.");
    const sourceId = fetched.sourceId as string;
    const runId = fetched.runId as string;

    const excerpt = dataOf(await call("source_get", { sourceId, maxChars: 100 }));
    expect(excerpt.url).toBe(`${site.baseUrl}/`);
    expect(excerpt.text).toContain("Visible words");

    const captured = dataOf(
      await call("source_capture", {
        companyId,
        url: "https://example.invalid/seen",
        text: "seen elsewhere",
        via: "browser",
      }),
    );
    expect(captured.runId).toBe(runId);

    const facts = dataOf(
      await call("fact_add", {
        companyId,
        runId,
        facts: [
          { key: "product.count", value: 12, sourceIds: [sourceId], confidence: "high" },
          { key: "bogus key!!", value: 1, sourceIds: [] },
        ],
      }),
    );
    const factResults = facts.results as { ok: boolean; error?: string; warnings?: string[] }[];
    expect(factResults[0]?.ok).toBe(true);
    expect(factResults[1]?.ok).toBe(false);

    const records = dataOf(
      await call("record_upsert", {
        companyId,
        runId,
        records: [
          {
            type: "retailer",
            data: { name: "Boots", kind: "retail" },
            sourceIds: [sourceId],
          },
        ],
      }),
    );
    expect(((records.results as { ok: boolean }[])[0]?.ok)).toBe(true);

    const v1 = dataOf(
      await call("document_save", {
        companyId,
        runId,
        path: "product/catalog.md",
        title: "Catalog",
        content: "# Catalog\n\nTwelve products.",
        sourceIds: [sourceId],
        factIds: [(factResults[0] as unknown as { id: string }).id],
      }),
    );
    expect(v1.outcome).toBe("created");
    const same = dataOf(
      await call("document_save", {
        companyId,
        path: "product/catalog.md",
        title: "Catalog",
        content: "# Catalog\n\nTwelve products.",
      }),
    );
    expect(same.outcome).toBe("unchanged");
    expect(same.id).toBe(v1.id);

    const doc = dataOf(await call("document_get", { documentId: v1.id }));
    expect(doc.area).toBe("product");
    expect((doc.sourceUrls as { url: string }[])[0]?.url).toBe(`${site.baseUrl}/`);
    const sliced = dataOf(await call("document_get", { documentId: v1.id, offset: 2, maxChars: 7 }));
    expect(sliced.content).toBe("Catalog");

    const listed = dataOf(await call("document_list", { companyId, prefix: "product/" }));
    expect((listed.documents as unknown[])).toHaveLength(1);
    const history = dataOf(await call("document_history", { documentId: v1.id }));
    expect((history.versions as unknown[])).toHaveLength(1);

    const found = dataOf(
      await call("finding_add", {
        companyId,
        runId,
        area: "product",
        claim: "Twelve-product catalog",
        sourceIds: [sourceId],
        confidence: "high",
        status: "supported",
      }),
    );
    expect(typeof found.id).toBe("string");

    const status = dataOf(
      await call("area_status_set", { runId, area: "product", status: "done" }),
    );
    expect(status.status).toBe("done");
    const needsReason = await call("area_status_set", { runId, area: "reviews", status: "blocked" });
    expect(errorOf(needsReason).code).toBe("invalid_input");

    const note = dataOf(
      await call("note_add", {
        companyId,
        area: "decisions",
        title: "Owner note",
        content: "Looked at this by hand.",
        sourceUrls: ["https://example.invalid/hand"],
      }),
    );
    expect(note.outcome).toBe("created");
  });

  it("ingests reviews and searches across kinds", async () => {
    const companyId = await makeCompany("Review Co");
    const fetched = dataOf(await call("source_fetch", { companyId, url: `${site.baseUrl}/` }));
    const sourceId = fetched.sourceId as string;
    const ingested = dataOf(
      await call("reviews_ingest", {
        companyId,
        platform: "testplatform",
        sourceId,
        reviews: Array.from({ length: 20 }, (_, i) => ({
          text: `excellent serum number ${i} with uniqueword${i}`,
          rating: 5,
          date: "2026-09-15",
        })),
      }),
    );
    expect((ingested.results as unknown[])).toHaveLength(20);
    expect(ingested.trimmed).toBe(0);

    const hits = dataOf(await call("search", { query: "uniqueword7", companyId }));
    expect(((hits.hits as { kind: string }[]).map((h) => h.kind))).toContain("record");
    const scoped = dataOf(await call("search", { query: "uniqueword7", companyId, kinds: ["document"] }));
    expect((scoped.hits as unknown[])).toHaveLength(0);
    const typeHits = dataOf(await call("records_list", { companyId, type: "review", query: "uniqueword3" }));
    expect((typeHits.records as unknown[])).toHaveLength(1);
    const current = dataOf(await call("facts_get", { companyId, keys: ["reviews.ingested_count"] }));
    expect(((current.facts as { value: number }[])[0]?.value)).toBe(20);
  });

  it("exports the company to real files", async () => {
    const companyId = await makeCompany("Export Co");
    const fetched = dataOf(await call("source_fetch", { companyId, url: `${site.baseUrl}/` }));
    const sourceId = fetched.sourceId as string;
    await call("fact_add", {
      companyId,
      facts: [{ key: "product.count", value: 3, sourceIds: [sourceId] }],
    });
    await call("document_save", {
      companyId,
      path: "product/catalog.md",
      title: "Catalog",
      content: "# Catalog",
      sourceIds: [sourceId],
    });
    const exported = dataOf(await call("company_export", { companyId }));
    const dir = exported.dir as string;
    try {
      expect(exported.documents).toBe(1);
      expect(exported.facts).toBe(1);
      const catalog = await readFile(join(dir, "product", "catalog.md"), "utf8");
      expect(catalog).toBe("# Catalog");
      const factsCsv = await readFile(join(dir, "facts.csv"), "utf8");
      expect(factsCsv).toContain("product.count");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("context and dossier sizes", () => {
  it("stays under 10 KB on the fixture company", async () => {
    const created = dataOf(
      await call("sector_create", { name: "Skincare", csvPaths: [fixtureCsvPath()] }),
    );
    const sector = created.sector as { id: string };
    const page = dataOf(await call("company_list", { sectorId: sector.id, pageSize: 1 }));
    const companyId = ((page.items as { id: string }[])[0] as { id: string }).id;

    const fetched = dataOf(await call("source_fetch", { companyId, url: `${site.baseUrl}/` }));
    const sourceId = fetched.sourceId as string;
    await call("fact_add", {
      companyId,
      facts: [
        { key: "product.count", value: 12, sourceIds: [sourceId] },
        { key: "hiring.open_roles", value: 4, sourceIds: [sourceId] },
      ],
    });
    await call("record_upsert", {
      companyId,
      records: [{ type: "retailer", data: { name: "Boots" }, sourceIds: [sourceId] }],
    });
    await call("document_save", {
      companyId,
      path: "product/catalog.md",
      title: "Catalog",
      content: "# Catalog\n\nA short extract.",
      sourceIds: [sourceId],
    });
    await call("finding_add", {
      companyId,
      area: "product",
      claim: "Small catalog",
      sourceIds: [sourceId],
      confidence: "medium",
      status: "supported",
    });

    const context = dataOf(await call("company_context", { companyId }));
    const dossier = dataOf(await call("company_dossier", { companyId }));
    expect(JSON.stringify(context).length).toBeLessThan(10 * 1024);
    expect(JSON.stringify(dossier).length).toBeLessThan(10 * 1024);
    expect((context.facts as unknown[])).toHaveLength(2);
    expect(((dossier.findingCounts as { total: number }).total)).toBe(1);
  });
});
