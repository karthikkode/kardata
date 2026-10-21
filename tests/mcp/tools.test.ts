import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companies, sectorCompanies, sectors } from "../../src/db/schema.js";
import { startServer, type ServerHandle } from "../../src/server.js";
import {
  badHeadersCsvPath,
  ensureMigrated,
  fixtureCsvPath,
  fixtureImportDirs,
  getTestDb,
  resetTestDb,
} from "../db.js";

const TOKEN = "test-operator-token";

const EXPECTED_TOOLS = [
  "sector_create",
  "sector_update",
  "sector_delete",
  "sector_list",
  "sector_get",
  "companies_import_csv",
  "company_add",
  "company_link",
  "company_update",
  "company_remove",
  "company_restore",
  "company_get",
  "company_list",
  "company_facets",
  "import_list",
  "collect_start",
  "batch_status",
  "run_get",
  "run_events",
  "run_finish",
  "run_cancel",
  "company_dossier",
  "document_get",
  "document_search",
  "source_get",
  "note_add",
  "registry_list",
  "registry_describe",
  "registry_curate",
  "source_fetch",
  "source_capture",
  "fact_add",
  "record_upsert",
  "reviews_ingest",
  "document_save",
  "document_list",
  "document_history",
  "company_export",
  "finding_add",
  "area_status_set",
  "company_context",
  "facts_get",
  "records_list",
  "search",
  "research_start",
  "run_activity",
  "collect_sector",
  "company_screen",
  "shortlist_save",
  "shortlist_get",
  "shortlist_list",
  "batch_scorecard",
  "extract_run",
  "research_sector",
  "research_shortlist",
  "job_status",
  "job_list",
  "job_pause",
  "job_resume",
  "job_cancel",
  "job_retry_failed",
  "harness_settings_get",
  "harness_settings_set",
  "preflight_report_save",
  "adapter_list",
  "company_job_start",
  "company_job_status",
  "company_jobs_list",
  "company_job_pause",
  "company_job_resume",
  "company_job_cancel",
  "company_job_retry",
  "company_concurrency_get",
  "company_concurrency_set",
  "pipeline_status",
  "pipeline_checkpoint_set",
  "sector_preflight_start",
  "sector_preflight_status",
  "sector_preflight_list",
  "sector_preflight_pause",
  "sector_preflight_resume",
  "sector_preflight_cancel",
  "sector_preflight_retry_failed",
  "sector_preflight_summary",
  "sector_rules_get",
  "sector_rules_set",
  "company_eligibility_override",
  "pipeline_start",
  "sector_preflight_concurrency_get",
  "sector_preflight_concurrency_set",
];

interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

let handle: DbHandle;
let server: ServerHandle;
let client: Client;
let previousImportDirs: string | undefined;

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

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    db: handle.db,
    operatorToken: TOKEN,
  });
  client = new Client({ name: "stage-1-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  previousImportDirs = process.env.KARDATA_IMPORT_DIRS;
  process.env.KARDATA_IMPORT_DIRS = fixtureImportDirs().join(",");
});

beforeEach(async () => {
  await resetTestDb(handle);
});

afterAll(async () => {
  if (previousImportDirs === undefined) delete process.env.KARDATA_IMPORT_DIRS;
  else process.env.KARDATA_IMPORT_DIRS = previousImportDirs;
  await client.close();
  await server.close();
  await handle.close();
});

describe("mcp tools", () => {
  it("lists exactly the stage-1 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
    }
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("sector_delete")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("company_remove")?.annotations?.destructiveHint).toBe(true);
  });

  it("runs the sector tools end to end", async () => {
    const created = dataOf(await call("sector_create", { name: "Skincare" }));
    const sector = created.sector as { id: string; name: string };
    expect(sector.name).toBe("Skincare");

    const dupe = await call("sector_create", { name: "skincare" });
    expect(errorOf(dupe).code).toBe("conflict");

    const updated = dataOf(
      await call("sector_update", { sectorId: sector.id, description: "d" }),
    );
    expect((updated.sector as { description: string }).description).toBe("d");

    const missing = await call("sector_get", {
      sectorId: "00000000-0000-0000-0000-000000000000",
    });
    expect(errorOf(missing).code).toBe("not_found");

    const fetched = dataOf(await call("sector_get", { sectorId: sector.id }));
    expect((fetched.sector as { name: string }).name).toBe("Skincare");

    const listed = dataOf(await call("sector_list", {}));
    expect((listed.sectors as unknown[]).length).toBe(1);

    const wrongConfirm = await call("sector_delete", {
      sectorId: sector.id,
      confirmName: "nope",
    });
    expect(errorOf(wrongConfirm).code).toBe("invalid_input");

    const deleted = dataOf(
      await call("sector_delete", { sectorId: sector.id, confirmName: "Skincare" }),
    );
    expect((deleted.sector as { id: string }).id).toBe(sector.id);
  });

  it("imports csv files and reports per-file results", async () => {
    const created = dataOf(await call("sector_create", { name: "Skincare" }));
    const sectorId = (created.sector as { id: string }).id;

    const result = dataOf(
      await call("companies_import_csv", { sectorId, paths: [fixtureCsvPath()] }),
    );
    const imports = result.imports as {
      ok: boolean;
      import: { createdCount: number; skippedCount: number };
    }[];
    expect(imports).toHaveLength(1);
    expect(imports[0]?.ok).toBe(true);
    expect(imports[0]?.import.createdCount).toBe(28);

    const bad = dataOf(
      await call("companies_import_csv", { sectorId, paths: [badHeadersCsvPath()] }),
    );
    const badImports = bad.imports as { ok: boolean; error: { code: string } }[];
    expect(badImports[0]?.ok).toBe(false);
    expect(badImports[0]?.error.code).toBe("file_error");

    const outside = await call("companies_import_csv", { sectorId, paths: ["/etc/hosts"] });
    expect(errorOf(outside).code).toBe("invalid_input");

    const listed = dataOf(await call("import_list", { sectorId }));
    expect((listed.imports as unknown[]).length).toBe(1);
  });

  it("runs the company write tools end to end", async () => {
    const created = dataOf(
      await call("sector_create", { name: "Skincare", csvPaths: [fixtureCsvPath()] }),
    );
    const sectorId = (created.sector as { id: string }).id;

    const added = dataOf(
      await call("company_add", {
        sectorId,
        name: "Handmade",
        website: "https://handmade.example",
        employees: 9,
      }),
    );
    const company = added.company as { id: string; domain: string };
    expect(company.domain).toBe("handmade.example");
    expect(added.possibleDuplicates).toEqual([]);

    const secondSector = dataOf(await call("sector_create", { name: "Second" }));
    const secondId = (secondSector.sector as { id: string }).id;
    const linked = dataOf(await call("company_link", { sectorId: secondId, companyId: company.id }));
    expect((linked.link as { revived: boolean }).revived).toBe(false);
    const relink = await call("company_link", { sectorId: secondId, companyId: company.id });
    expect(errorOf(relink).code).toBe("conflict");

    const updated = dataOf(
      await call("company_update", { companyId: company.id, patch: { name: "Renamed" } }),
    );
    expect((updated.company as { name: string }).name).toBe("Renamed");
    const badPatch = await call("company_update", {
      companyId: company.id,
      patch: { nope: 1 },
    });
    expect(errorOf(badPatch).code).toBe("invalid_input");

    await call("company_remove", { sectorId, companyId: company.id });
    const removed = dataOf(await call("company_get", { companyId: company.id }));
    const sectors = (removed.company as { sectors: { removed: boolean }[] }).sectors;
    expect(sectors.find((s) => s.removed)).toBeTruthy();
    await call("company_restore", { sectorId, companyId: company.id });

    const missing = await call("company_get", {
      companyId: "00000000-0000-0000-0000-000000000000",
    });
    expect(errorOf(missing).code).toBe("not_found");
  });

  it("runs the company read tools", async () => {
    const created = dataOf(
      await call("sector_create", { name: "Skincare", csvPaths: [fixtureCsvPath()] }),
    );
    const sectorId = (created.sector as { id: string }).id;

    const page = dataOf(
      await call("company_list", {
        sectorId,
        country: ["United States"],
        sort: "employees",
        order: "desc",
        pageSize: 50,
      }),
    );
    expect(typeof page.durationMs).toBe("number");
    expect(page.total).toBeGreaterThan(0);
    expect(((page.items as { country: string }[])[0] ?? {}).country).toBe("United States");

    const badPage = await call("company_list", { sectorId, pageSize: 201 });
    expect(errorOf(badPage).code).toBe("invalid_input");

    const facets = dataOf(await call("company_facets", { sectorId }));
    for (const key of ["countries", "industries", "employeeBands", "technologies"]) {
      expect(Array.isArray(facets[key]), key).toBe(true);
    }
  });

  it("runs the company job tools end to end", async () => {
    const created = dataOf(await call("sector_create", { name: "Skincare" }));
    const sectorId = (created.sector as { id: string }).id;
    const added = dataOf(
      await call("company_add", { sectorId, name: "Acme", website: "https://acme.example" }),
    );
    const companyId = (added.company as { id: string }).id;

    const started = dataOf(await call("company_job_start", { companyId }));
    const jobId = (started as { jobId: string }).jobId;
    expect(typeof jobId).toBe("string");
    const dupe = await call("company_job_start", { companyId });
    expect(errorOf(dupe).code).toBe("conflict");

    const status = dataOf(await call("company_job_status", { jobId }));
    expect((status.job as { status: string }).status).toBe("running");
    expect(status.derived).toBe("incomplete");

    const listed = dataOf(await call("company_jobs_list", {}));
    expect(((listed.jobs as unknown[]) ?? []).length).toBe(1);

    await call("company_job_pause", { jobId });
    const paused = dataOf(await call("company_job_status", { jobId }));
    expect((paused.job as { status: string }).status).toBe("paused");
    await call("company_job_resume", { jobId });
    const resumed = dataOf(await call("company_job_status", { jobId }));
    expect((resumed.job as { status: string }).status).toBe("running");

    const adapters = dataOf(await call("adapter_list", {}));
    const entries = (adapters.adapters as { id: string; version: string }[]) ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(12);
    expect(entries.map((a) => a.id)).toContain("reviews_onsite");
    expect(entries.every((a) => /^\d+\.\d+\.\d+$/.test(a.version))).toBe(true);

    const conc = dataOf(await call("company_concurrency_get", {}));
    expect(conc.companyConcurrency).toBe(4);
    const updated = dataOf(await call("company_concurrency_set", { companyConcurrency: 12 }));
    expect(updated.companyConcurrency).toBe(12);
    const badConc = await call("company_concurrency_set", { companyConcurrency: 101 });
    expect(errorOf(badConc).code).toBe("invalid_input");

    const pipe = dataOf(await call("pipeline_status", {}));
    expect(pipe.checkpointTarget).toBeNull();
    expect((pipe.paused as { paused: boolean }).paused).toBe(false);
    expect(pipe.quota).toBeNull();
    const checkpoint = dataOf(await call("pipeline_checkpoint_set", { afterCompleted: 25 }));
    expect(checkpoint.target).toBe(25);
    const badCheckpoint = await call("pipeline_checkpoint_set", { afterCompleted: 0 });
    expect(errorOf(badCheckpoint).code).toBe("invalid_input");
    const cleared = dataOf(await call("pipeline_checkpoint_set", { afterCompleted: null }));
    expect(cleared.target).toBeNull();
  });

  it("sector preflight tools: job controls, rules, overrides, pipeline start", async () => {
    const [sector] = await handle.db.insert(sectors).values({ id: randomUUID(), name: "Skincare" }).returning();
    if (!sector) throw new Error("no sector row");
    const [company] = await handle.db
      .insert(companies)
      .values({ id: randomUUID(), source: "manual", name: "A Co" })
      .returning();
    if (!company) throw new Error("no company row");
    await handle.db.insert(sectorCompanies).values({ sectorId: sector.id, companyId: company.id, addedVia: "manual" });

    const started = dataOf(await call("sector_preflight_start", { sectorId: sector.id }));
    expect(started.companies).toBe(1);
    const jobId = (started as { jobId: string }).jobId;
    const status = dataOf(await call("sector_preflight_status", { jobId }));
    expect((status.job as { status: string }).status).toBe("running");
    expect(status.quota).toBeNull();
    const listed = dataOf(await call("sector_preflight_list", {}));
    expect(((listed as { jobs: unknown[] }).jobs)).toHaveLength(1);
    await call("sector_preflight_pause", { jobId });
    const paused = dataOf(await call("sector_preflight_status", { jobId }));
    expect((paused.job as { status: string }).status).toBe("paused");
    await call("sector_preflight_resume", { jobId });
    await call("sector_preflight_cancel", { jobId });
    const cancelled = dataOf(await call("sector_preflight_status", { jobId }));
    expect((cancelled.job as { status: string }).status).toBe("cancelled");
    const retried = dataOf(await call("sector_preflight_retry_failed", { jobId }));
    expect(retried.retried).toBe(0);

    const summary = dataOf(await call("sector_preflight_summary", { sectorId: sector.id }));
    expect((summary as { buckets: unknown[] }).buckets).toHaveLength(0);

    const rules = dataOf(await call("sector_rules_get", { sectorId: sector.id }));
    expect(rules.isDefault).toBe(true);
    const badRules = await call("sector_rules_set", { sectorId: sector.id, rules: { nope: true } });
    expect(errorOf(badRules).code).toBe("invalid_input");

    const override = dataOf(
      await call("company_eligibility_override", {
        sectorId: sector.id,
        companyId: company.id,
        decision: "include",
        note: "owner call",
      }),
    );
    expect(override.eligibility).toBe("eligible");
    const clearedOverride = dataOf(
      await call("company_eligibility_override", {
        sectorId: sector.id,
        companyId: company.id,
        decision: "clear",
      }),
    );
    expect(clearedOverride.eligibility).toBe("pending");

    const launched = dataOf(await call("pipeline_start", { sectorId: sector.id }));
    expect(launched.created).toBe(0);

    const pool = dataOf(await call("sector_preflight_concurrency_get", {}));
    expect(pool.sectorPreflightConcurrency).toBe(8);
    const poolSet = dataOf(await call("sector_preflight_concurrency_set", { sectorPreflightConcurrency: 4 }));
    expect(poolSet.sectorPreflightConcurrency).toBe(4);
    const poolBad = await call("sector_preflight_concurrency_set", { sectorPreflightConcurrency: 99 });
    expect(errorOf(poolBad).code).toBe("invalid_input");
  });

  it("company job cancel rejects retry", async () => {
    const [company] = await handle.db
      .insert(companies)
      .values({ id: randomUUID(), source: "manual", name: "Cancel Co" })
      .returning();
    if (!company) throw new Error("no company row");
    const started = dataOf(await call("company_job_start", { companyId: company.id }));
    const jobId = (started as { jobId: string }).jobId;
    await call("company_job_cancel", { jobId });
    const cancelled = dataOf(await call("company_job_status", { jobId }));
    expect((cancelled.job as { status: string }).status).toBe("cancelled");
    const noRetry = await call("company_job_retry", { jobId });
    expect(errorOf(noRetry).code).toBe("invalid_input");
  });

  it("rejects requests without a token", async () => {
    const url = new URL("/mcp", server.url).toString();
    const noAuth = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(noAuth.status).toBe(401);
    const wrongAuth = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(wrongAuth.status).toBe(401);
    const health = await fetch(new URL("/healthz", server.url).toString());
    expect(health.status).toBe(200);
  });
});
