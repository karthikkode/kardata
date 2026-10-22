import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, researchRuns, sources, webSearches } from "../../src/db/schema.js";
import { ingestWebSearches } from "../../src/domain/logging/web-searches.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

describe("ingestWebSearches", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = getTestDb();
    await ensureMigrated(handle);
  });

  beforeEach(async () => {
    await resetTestDb(handle);
  });

  afterAll(async () => {
    await handle.close();
  });

  async function setup() {
    const [co] = await handle.db
      .insert(companies)
      .values({ id: randomUUID(), source: "manual", name: "Search Co" })
      .returning({ id: companies.id });
    const companyId = co?.id ?? "";
    const [run] = await handle.db
      .insert(researchRuns)
      .values({ id: randomUUID(), companyId, kind: "agent", status: "succeeded" })
      .returning();
    if (!run) throw new Error("no run");
    return { companyId, run };
  }

  async function addSource(companyId: string, runId: string, url: string): Promise<string> {
    const [row] = await handle.db
      .insert(sources)
      .values({ id: randomUUID(), companyId, runId, url, finalUrl: url, collector: "capture", status: "ok", via: "search" })
      .returning({ id: sources.id });
    return row?.id ?? "";
  }

  it("stores searches and links sources by URL", async () => {
    const { companyId, run } = await setup();
    const hitId = await addSource(companyId, run.id, "https://example.invalid/a/");
    const missId = await addSource(companyId, run.id, "https://example.invalid/unrelated");
    const { inserted, linked } = await ingestWebSearches(handle.db, run, [
      {
        call_id: "call_s1",
        tool: "web_search",
        query_or_url: "Acme skincare",
        results: [{ url: "https://example.invalid/a", title: "A", snippet: "aaa", rank: 0 }],
        result_count: 1,
        at: "2026-10-21T10:00:00.000Z",
        area: "reviews",
        child_session_id: null,
      },
      {
        call_id: "call_f1",
        tool: "web_fetch",
        query_or_url: "https://example.invalid/b",
        results: [{ url: "https://example.invalid/b", title: null, snippet: "body", rank: 0 }],
        result_count: 1,
        at: null,
        area: "product",
        child_session_id: "child-9",
      },
    ]);
    expect(inserted).toBe(2);
    expect(linked).toBe(1);
    const rows = await handle.db.select().from(webSearches).where(eq(webSearches.runId, run.id));
    expect(rows).toHaveLength(2);
    const search = rows.find((r) => r.tool === "web_search");
    expect(search?.area).toBe("reviews");
    expect(search?.resultCount).toBe(1);
    const [hit] = await handle.db.select().from(sources).where(eq(sources.id, hitId));
    expect(hit?.webSearchId).toBe(search?.id);
    const [miss] = await handle.db.select().from(sources).where(eq(sources.id, missId));
    expect(miss?.webSearchId).toBeNull();
  });

  it("ingests nothing for an empty list", async () => {
    const { run } = await setup();
    await expect(ingestWebSearches(handle.db, run, [])).resolves.toEqual({ inserted: 0, linked: 0 });
  });
});
