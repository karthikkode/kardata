import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  blobs,
  companies,
  httpFetches,
  providerCalls,
  researchRuns,
  runEvents,
  type ResearchRun,
} from "../../src/db/schema.js";
import { logJobEvent } from "../../src/domain/company-jobs/events.js";
import { jobReplay } from "../../src/domain/logging/replay.js";
import { logHttpFetch } from "../../src/domain/logging/http.js";
import {
  attachDispatchSession,
  ingestSessionCalls,
  logDispatchPrompt,
  logExtractorCall,
  type SessionCall,
} from "../../src/domain/logging/provider-calls.js";
import { auditInlineOrBlob } from "../../src/mcp/auth.js";
import { runExtraction } from "../../src/runs/extract.js";
import { startCompanyJob } from "../../src/runs/company.js";
import { ingestRunSession } from "../../src/runs/usage.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

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

async function makeCompany(name: string): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeRun(companyId: string, opts: { jobId?: string; stage?: ResearchRun["stage"] } = {}): Promise<ResearchRun> {
  const [row] = await handle.db
    .insert(researchRuns)
    .values({
      id: randomUUID(),
      companyId,
      kind: "agent",
      status: "succeeded",
      companyJobId: opts.jobId ?? null,
      stage: opts.stage ?? null,
    })
    .returning();
  if (!row) throw new Error("no run row");
  return row;
}

async function blobText(sha: string): Promise<string> {
  const [blob] = await handle.db.select().from(blobs).where(eq(blobs.sha256, sha));
  if (!blob) throw new Error("blob missing");
  return gunzipSync(blob.gzip).toString("utf8");
}

function sessionCall(overrides: Partial<SessionCall> = {}): SessionCall {
  return {
    usage_id: `usage-${randomUUID()}`,
    session_id: "session-1",
    child_session_id: null,
    seq: 10,
    response_id: "resp-1",
    model: "synthetic-model-1",
    provider: "synthetic",
    input_tokens: 100,
    output_tokens: 20,
    cached_tokens: 10,
    reasoning_tokens: 5,
    at: "2026-10-20T00:00:00.000Z",
    messages: [{ phase: "commentary", text: "hello" }],
    tool_calls: [{ name: "mcp__kardata__search", call_id: "call-1" }],
    ...overrides,
  };
}

describe("session-reader.mjs", () => {
  it("pairs provider usage with responses, messages and tool calls, including children", async () => {
    const sid = "01fixture00000000000000000001";
    const root = mkdtempSync(join(tmpdir(), "sessions-"));
    try {
      const dir = join(root, "2026", "10", "20", sid);
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(process.cwd(), "tests/fixtures/session-sample.jsonl"), join(dir, "session.jsonl"));
      const childDir = join(dir, "subagent", "01fixture00000000000000000c01");
      mkdirSync(childDir, { recursive: true });
      copyFileSync(join(process.cwd(), "tests/fixtures/session-sample-child.jsonl"), join(childDir, "session.jsonl"));
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [join(process.cwd(), "harness/session-reader.mjs"), sid, root],
          { timeout: 30_000 },
          (err, out) => (err ? reject(err) : resolve(out)),
        );
      });
      const parsed = JSON.parse(stdout) as { calls: Record<string, unknown>[]; model: string };
      expect(parsed.model).toBe("synthetic-model-1");
      expect(parsed.calls).toHaveLength(3);
      const first = parsed.calls[0] as Record<string, unknown>;
      expect(first.usage_id).toBe("usage-one");
      expect(first.response_id).toBe("resp-one");
      expect(first.input_tokens).toBe(100);
      expect(first.provider).toBe("synthetic");
      expect(new Date(first.at as string).getTime()).toBe(1792534017200);
      expect((first.messages as { text: string }[]).map((m) => m.text)).toEqual([
        "Starting synthetic research.",
      ]);
      expect((first.tool_calls as { name: string }[]).map((c) => c.name)).toEqual([
        "mcp__kardata__company_context",
      ]);
      // Tool-family attribution rows carry no tokens and are skipped.
      expect(parsed.calls.map((c) => c.usage_id).sort()).toEqual(["usage-child-1", "usage-one", "usage-two"]);
      const child = parsed.calls.find((c) => c.usage_id === "usage-child-1");
      expect(child?.child_session_id).toBe("01fixture00000000000000000c01");
      expect(child?.response_id).toBe("resp-child-1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("providerCalls", () => {
  it("captures dispatch prompts, ingests calls exactly once, and backfills turn 1", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const run = await makeRun(companyId, { jobId, stage: "research" });

    const dispatchId = await logDispatchPrompt(handle.db, run, "research this company");
    await attachDispatchSession(handle.db, dispatchId, "session-1");
    const [dispatch] = await handle.db.select().from(providerCalls).where(eq(providerCalls.id, dispatchId));
    expect(dispatch?.sessionId).toBe("session-1");
    expect(dispatch?.usageId).toBeNull();
    expect(dispatch ? await blobText(dispatch.promptSha256 as string) : "").toBe("research this company");

    const first = await ingestSessionCalls(handle.db, run, [
      sessionCall({ usage_id: "u-1", seq: 10, response_id: "r-1" }),
      sessionCall({ usage_id: "u-2", seq: 20, response_id: "r-2", child_session_id: "child-1" }),
    ]);
    expect(first.inserted).toBe(2);
    const again = await ingestSessionCalls(handle.db, run, [
      sessionCall({ usage_id: "u-1", seq: 10, response_id: "r-1" }),
    ]);
    expect(again.inserted).toBe(0);

    const rows = await handle.db
      .select()
      .from(providerCalls)
      .where(eq(providerCalls.runId, run.id))
      .orderBy(asc(providerCalls.id));
    expect(rows).toHaveLength(3);
    const callRow = rows.find((r) => r.usageId === "u-1");
    expect(callRow?.inputTokens).toBe(100);
    expect(callRow?.responseSha256).not.toBeNull();
    expect(callRow ? await blobText(callRow.responseSha256 as string) : "").toContain("hello");
    // Turn-1 prompt backfilled onto the earliest call row.
    expect(callRow?.promptSha256).toBe(dispatch?.promptSha256);
    expect(rows.find((r) => r.usageId === "u-2")?.childSessionId).toBe("child-1");
  });

  it("logs extractor calls inline with prompt, response, usage and duration", async () => {
    const companyId = await makeCompany("Acme");
    const run = await makeRun(companyId);
    await logExtractorCall(handle.db, run, {
      seq: 3,
      prompt: "extract marketing",
      raw: '{"facts":[]}',
      json: { facts: [] },
      usage: { model: "fake", inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0, calls: 1 },
      durationMs: 123,
    });
    const rows = await handle.db.select().from(providerCalls).where(eq(providerCalls.runId, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stage).toBe("extraction");
    expect(rows[0]?.seq).toBe(3);
    expect(rows[0]?.durationMs).toBe(123);
    expect(rows[0] ? await blobText(rows[0].promptSha256 as string) : "").toBe("extract marketing");
    expect(rows[0]?.responseSha256).not.toBeNull();
  });

  it("runExtraction logs one row per area call", async () => {
    const companyId = await makeCompany("Acme");
    const run = await makeRun(companyId);
    const outcome = await runExtraction(handle.db, run, {
      call: async () => ({
        json: { facts: [], records: [], findings: [] },
        usage: { model: "fake", inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0, calls: 1 },
        raw: '{"facts":[],"records":[],"findings":[]}',
      }),
    });
    expect(outcome.areas).toHaveLength(8);
    const rows = await handle.db
      .select()
      .from(providerCalls)
      .where(eq(providerCalls.runId, run.id))
      .orderBy(asc(providerCalls.seq));
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(rows.map((r) => r.stage))).toEqual(new Set(["extraction"]));
    expect(rows[0]?.model).toBe("fake");
    expect(rows[0]?.inputTokens).toBe(10);
  });
});

describe("ingestRunSession", () => {
  it("ingests reader output and explains gaps without throwing", async () => {
    const companyId = await makeCompany("Acme");
    const run = await makeRun(companyId);
    const summary = await ingestRunSession(handle.db, run, "session-1", async () => ({
      ok: true,
      stdout: JSON.stringify({
        calls: [
          {
            usage_id: "u-9",
            session_id: "session-1",
            child_session_id: null,
            seq: 5,
            response_id: "r-9",
            model: "m",
            provider: "p",
            input_tokens: 7,
            output_tokens: 8,
            cached_tokens: 0,
            reasoning_tokens: 0,
            at: null,
            messages: [],
            tool_calls: [],
          },
          { garbage: true },
        ],
      }),
    }));
    expect(summary.calls).toBe(1);
    const rows = await handle.db.select().from(providerCalls).where(eq(providerCalls.runId, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usageId).toBe("u-9");

    const missing = await ingestRunSession(handle.db, run, undefined, async () => {
      throw new Error("reader must not run without a session id");
    });
    expect(missing).toEqual({ calls: 0, note: expect.stringContaining("no session id") });
    const bad = await ingestRunSession(handle.db, run, "session-1", async () => ({ ok: true, stdout: "nope" }));
    expect(bad.calls).toBe(0);
    expect(bad.note).toMatch(/invalid JSON/);
  });
});

describe("auditInlineOrBlob", () => {
  it("inlines small texts, blob-stores medium ones, flags huge ones", async () => {
    const small = await auditInlineOrBlob(handle.db, '{"a":1}', 2048);
    expect(small).toEqual({ inline: '{"a":1}', sha: null, truncated: false });
    const medium = await auditInlineOrBlob(handle.db, `{"pad":"${"x".repeat(3000)}"}`, 2048);
    expect(medium.sha).not.toBeNull();
    expect(medium.truncated).toBe(false);
    expect(medium.inline).toHaveLength(2048);
    expect(await blobText(medium.sha as string)).toContain("x".repeat(100));
    const huge = await auditInlineOrBlob(handle.db, "y".repeat(300_000), 2048);
    expect(huge).toEqual({ inline: "y".repeat(2048), sha: null, truncated: true });
  });
});

describe("logHttpFetch", () => {
  it("stores one row per call with the job link resolved from the run", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const run = await makeRun(companyId, { jobId, stage: "collect" });
    await logHttpFetch(
      handle.db,
      { runId: run.id, companyId, collector: "shopify", url: "https://example.com/p.json" },
      { statusCode: 200, bytes: 42, durationMs: 7, sourceId: null, error: null },
    );
    const rows = await handle.db.select().from(httpFetches).where(eq(httpFetches.runId, run.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.companyJobId).toBe(jobId);
    expect(rows[0]?.host).toBe("example.com");
  });
});

describe("jobReplay", () => {
  it("returns every log table for a job, oldest first", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const run = await makeRun(companyId, { jobId, stage: "research" });
    await logDispatchPrompt(handle.db, run, "prompt");
    await logJobEvent(handle.db, jobId, "stage_started", "research");
    await logHttpFetch(
      handle.db,
      { runId: run.id, companyId, collector: "test", url: "https://example.com/" },
      { statusCode: 200, bytes: 1, durationMs: 1 },
    );
    await handle.db.insert(runEvents).values({ runId: run.id, type: "mcp_call", payload: { tool: "search", status: "ok", args: "{}" } });
    const replay = await jobReplay(handle.db, jobId);
    expect(replay.providerCalls).toHaveLength(1);
    expect(replay.jobEvents.map((e) => e.type)).toContain("stage_started");
    expect(replay.httpFetches).toHaveLength(1);
    expect(replay.mcpCalls).toHaveLength(1);
    expect(replay.mcpCalls[0]?.tool).toBe("search");
  });
});
