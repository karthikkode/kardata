import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { companyJobs, sectorCompanies, sectorPreflightJobs } from "../../src/db/schema.js";
import { runIcpCheck } from "../../src/runs/icp.js";
import { createSectorRunner } from "../../src/runs/sector.js";
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
  return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
}

function dataOf(result: ToolResult): Record<string, unknown> {
  if (result.isError) throw new Error(`tool failed: ${JSON.stringify(result.structuredContent ?? result.content)}`);
  return result.structuredContent ?? {};
}

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
  server = await startServer({ host: "127.0.0.1", port: 0, db: handle.db, operatorToken: TOKEN });
  client = new Client({ name: "icp-test", version: "1.0.0" });
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

async function seedSector(): Promise<{ sectorId: string; researched: string; fresh: string }> {
  const sector = dataOf(await call("sector_create", { name: "ICP Test" }));
  const sectorId = (sector.sector as { id: string }).id;
  const add = async (name: string) =>
    ((dataOf(await call("company_add", { sectorId, name })).company as { id: string }).id);
  const researched = await add("Researched Co");
  const fresh = await add("Not Yet Co");
  // Both passed preflight, so both are sector companies.
  await handle.db.update(sectorCompanies).set({ eligibility: "eligible" }).where(eq(sectorCompanies.sectorId, sectorId));
  await handle.db.insert(companyJobs).values({ id: randomUUID(), companyId: researched, status: "completed" });
  return { sectorId, researched, fresh };
}

describe("ICP tools", () => {
  it("starts a sector ICP job on researched members, runs it, and reads the results", async () => {
    const { sectorId, researched } = await seedSector();
    const started = dataOf(await call("sector_icp_start", { sectorId }));
    expect(started.companies).toBe(1);
    const jobId = started.jobId as string;

    const runner = createSectorRunner(handle.db, {
      icp: (input) => runIcpCheck(handle.db, { ...input, call: async () => ({ json: {}, usage: undefined }) }),
    });
    for (let i = 0; i < 5; i += 1) {
      await runner.tick();
      await new Promise((r) => setTimeout(r, 50));
    }
    const status = dataOf(await call("sector_icp_status", { jobId }));
    expect((status.job as { status: string; kind: string })).toMatchObject({ status: "completed", kind: "icp" });

    const view = dataOf(await call("company_icp_get", { companyId: researched }));
    expect(view).toMatchObject({ checks: 1, status: "research_incomplete" });

    const list = dataOf(await call("sector_icp_companies", { sectorId, status: ["research_incomplete"] }));
    expect(list.total).toBe(1);
    expect((list.rows as { companyId: string }[])[0]?.companyId).toBe(researched);

    // A second start skips companies already checked; onlyMissing false re-checks.
    expect(dataOf(await call("sector_icp_start", { sectorId })).companies).toBe(0);
    expect(dataOf(await call("sector_icp_start", { sectorId, onlyMissing: false })).companies).toBe(1);
  });

  it("checks explicit members even without research, and refuses outsiders", async () => {
    const { sectorId, fresh } = await seedSector();
    expect(dataOf(await call("sector_icp_start", { sectorId, companyIds: [fresh] })).companies).toBe(1);
    const bad = await call("sector_icp_start", { sectorId, companyIds: [randomUUID()] });
    expect(bad.isError).toBe(true);
  });

  it("sector_icp_status refuses a preflight job", async () => {
    const { sectorId } = await seedSector();
    const jobId = randomUUID();
    await handle.db.insert(sectorPreflightJobs).values({ id: jobId, sectorId });
    const res = await call("sector_icp_status", { jobId });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.structuredContent ?? res.content)).toContain("not an ICP job");
  });

  it("company_icp_get says when there is no check", async () => {
    const { fresh } = await seedSector();
    const res = await call("company_icp_get", { companyId: fresh });
    expect(res.content[0]?.text).toContain("no ICP check yet");
  });

  it("records Apollo contact statuses and reports contactable only for a verified Apollo email", async () => {
    const { sectorId, researched, fresh } = await seedSector();
    const recorded = dataOf(
      await call("company_contacts_record", {
        items: [
          { companyId: researched, counts: { name_verified_apollo: 1, email_verified_apollo: 1 }, source: "apollo test pull" },
          { companyId: fresh, counts: { name_verified_apollo: 1, phone_verified_apollo: 1 }, source: "apollo test pull" },
        ],
      }),
    );
    expect((recorded.results as { ok: boolean; contactable: boolean }[]).map((r) => r.contactable)).toEqual([true, false]);
    expect(dataOf(await call("company_contacts_get", { companyId: researched }))).toMatchObject({ contactable: true });
    expect(dataOf(await call("sector_contacts_rederive", { sectorId }))).toEqual({ companies: 2, withName: 0, withRole: 0 });
    // Public statuses cannot be written through the Apollo tool.
    const bad = await call("company_contacts_record", {
      items: [{ companyId: fresh, counts: { name_verified_public: 1 }, source: "apollo test pull" }],
    });
    expect(bad.isError).toBe(true);
  });
});
