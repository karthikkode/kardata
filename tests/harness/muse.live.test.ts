/**
 * @live — real containerized Muse run (the app-owned login) against a
 * hermetic test-DB server. Skipped unless KARDATA_LIVE=1 (see
 * `npm run test:live`); never runs in CI/default suite.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { documents } from "../../src/db/schema.js";
import { importCsv } from "../../src/domain/imports.js";
import { createSector } from "../../src/domain/sectors.js";
import { RESEARCH_MUSE_ARGS, dockerMuseHarness } from "../../src/harness/docker.js";
import { AGENTS_GATEWAY } from "../../src/harness/setup.js";
import type { HarnessEvent } from "../../src/harness/types.js";
import { startServer, type ServerHandle } from "../../src/server.js";
import {
  ensureMigrated,
  fixtureCsvPath,
  fixtureImportDirs,
  getTestDb,
  resetTestDb,
} from "../db.js";

const TOKEN = "live-harness-token";

describe.skipIf(!process.env.KARDATA_LIVE)("muse harness @live", () => {
  let handle: DbHandle;
  let server: ServerHandle;
  let companyId: string;

  beforeAll(async () => {
    handle = getTestDb();
    await ensureMigrated(handle);
    await resetTestDb(handle);
    // 0.0.0.0 keeps the hermetic test robust; production listens on
    // 127.0.0.1 and the agent-network gateway only. The container reaches
    // the host through the agent gateway.
    server = await startServer({ host: "0.0.0.0", port: 0, db: handle.db, operatorToken: TOKEN });
    const { sector } = await createSector(handle.db, { name: "Live Fixture" });
    const [result] = await importCsv(handle.db, sector.id, [fixtureCsvPath()], {
      importDirs: fixtureImportDirs(),
    });
    if (!result?.ok) throw new Error("fixture import failed");
    const [doc] = await handle.db
      .select({ id: documents.id })
      .from(documents)
      .limit(1);
    if (doc) throw new Error("expected no documents before the run");
    const companies = await handle.db.query.companies.findMany({ limit: 1 });
    if (!companies[0]) throw new Error("no fixture company");
    companyId = companies[0].id;
  }, 60_000);

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it(
    "researches a fixture company and writes a note through kardata MCP",
    async () => {
      const port = new URL(server.url).port;
      const run = dockerMuseHarness.start({
        runId: randomUUID(),
        // The container's workspace is tmpfs; the host path is unused.
        workspaceDir: "/workspace",
        prompt:
          `Call the kardata MCP tool company_context with companyId ${companyId}. ` +
          `Then call the kardata MCP tool note_add with that companyId, area "product", ` +
          `title "Live note", content "harness check". Reply DONE.`,
        mcpServers: [
          {
            name: "kardata",
            url: `http://${AGENTS_GATEWAY}:${port}/mcp`,
            headers: { Authorization: "${KARDATA_MCP_AUTH}" },
          },
        ],
        env: { KARDATA_MCP_AUTH: `Bearer ${TOKEN}` },
        limits: { maxModelSteps: 5 },
        extraArgs: RESEARCH_MUSE_ARGS,
      });
      const events: HarnessEvent[] = [];
      const draining = (async () => {
        for await (const event of run.events) events.push(event);
      })();
      const result = await run.wait();
      await draining;
      expect(result.exitCode).toBe(0);
      expect(result.finalMessage).toContain("DONE");
      const calls = events.filter((e) => e.type === "tool_call").map((e) => (e as { name: string }).name);
      expect(calls).toContain("mcp__kardata__company_context");
      expect(calls).toContain("mcp__kardata__note_add");
      expect(events.some((e) => e.type === "finished" && e.terminal === "completed")).toBe(true);
      expect(events.some((e) => e.type === "usage")).toBe(true);
      const notes = await handle.db
        .select()
        .from(documents)
        .where(eq(documents.companyId, companyId));
      expect(notes).toHaveLength(1);
      expect(notes[0]?.kind).toBe("agent_note");
      expect(notes[0]?.createdBy).toBe("owner");
    },
    240_000,
  );
});
