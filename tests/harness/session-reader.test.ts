import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const READER = new URL("../../harness/session-reader.mjs", import.meta.url).pathname;

function record(seq: number, inner: Record<string, unknown>, recordedAt = 1792584170699886): string {
  return JSON.stringify({
    schema_version: 1,
    id: `rec-${seq}`,
    stream: { kind: "session", id: "sess-1" },
    sequence: seq,
    recorded_at: recordedAt,
    record_type: "event",
    payload: { event: inner },
  });
}

function committed(seq: number, toolCalls: unknown[]): string {
  return record(seq, { kind: "assistant_tool_calls_committed", response_id: `resp-${seq}`, tool_calls: toolCalls });
}

function results(seq: number, rows: unknown[]): string {
  return record(seq, { kind: "tool_result_batch_committed", batch_id: `b-${seq}`, results: rows });
}

interface ReaderSearch {
  tool: string;
  query_or_url: string;
  results: { url: string; title: string | null; snippet: string | null; rank: number }[];
  result_count: number;
  at: string | null;
  area: string | null;
  child_session_id: string | null;
}

function runReader(root: string, sessionId: string): Promise<{ calls: unknown[]; searches: ReaderSearch[] }> {
  return new Promise((resolve, reject) => {
    execFile("node", [READER, sessionId, root], (err, stdout) => {
      if (err) reject(err);
      else resolve(JSON.parse(stdout));
    });
  });
}

describe("session-reader web searches", () => {
  it("parses web_search and web_fetch with results and areas", async () => {
    const root = mkdtempSync(join(tmpdir(), "sessroot-"));
    const main = join(root, "2026", "10", "21", "sess-1");
    const child = join(main, "subagent", "child-9");
    mkdirSync(child, { recursive: true });
    const searchResult = JSON.stringify({
      query: "Acme skincare",
      results: [
        { url: "https://example.invalid/a", title: "A", snippet: "aaa", page_last_modified: -1 },
        { url: "https://example.invalid/b", title: "B", snippet: "bbb", page_last_modified: -1 },
      ],
    });
    writeFileSync(
      join(main, "session.jsonl"),
      [
        committed(10, [{ name: "web_search", call_id: "call_s1", args: JSON.stringify({ query: "Acme skincare" }) }]),
        results(11, [{ text: searchResult, tool_call_id: "call_s1", tool_call_index: 0 }]),
        committed(12, [
          { name: "mcp__kardata__area_status_set", call_id: "call_a", args: JSON.stringify({ area: "reviews", status: "done" }) },
        ]),
        results(13, [{ text: "ok", tool_call_id: "call_a", tool_call_index: 0 }]),
      ].join("\n"),
    );
    writeFileSync(
      join(child, "session.jsonl"),
      [
        committed(20, [{ name: "web_fetch", call_id: "call_f1", args: JSON.stringify({ url: "https://example.invalid/a" }) }]),
        results(21, [{ text: "page body here", tool_call_id: "call_f1", tool_call_index: 0 }]),
        committed(22, [
          { name: "mcp__kardata__document_save", call_id: "call_d", args: JSON.stringify({ path: "product/notes.md" }) },
        ]),
      ].join("\n"),
    );
    const out = await runReader(root, "sess-1");
    expect(out.searches).toHaveLength(2);
    const search = out.searches.find((s) => s.tool === "web_search") as ReaderSearch;
    expect(search.query_or_url).toBe("Acme skincare");
    expect(search.result_count).toBe(2);
    expect(search.results[0]).toMatchObject({ url: "https://example.invalid/a", title: "A", rank: 0 });
    expect(search.area).toBe("reviews");
    expect(search.child_session_id).toBeNull();
    expect(search.at).toContain("2026-");
    const fetch = out.searches.find((s) => s.tool === "web_fetch") as ReaderSearch;
    expect(fetch.query_or_url).toBe("https://example.invalid/a");
    expect(fetch.result_count).toBe(1);
    expect(fetch.results[0].snippet).toBe("page body here");
    expect(fetch.area).toBe("product");
    expect(fetch.child_session_id).toBe("child-9");
  });

  it("keeps searches with missing results and bare doc paths vote other", async () => {
    const root = mkdtempSync(join(tmpdir(), "sessroot-"));
    const main = join(root, "2026", "10", "21", "sess-2");
    mkdirSync(main, { recursive: true });
    writeFileSync(
      join(main, "session.jsonl"),
      [
        committed(10, [{ name: "web_search", call_id: "call_x", args: JSON.stringify({ query: "q" }) }]),
        committed(11, [
          { name: "mcp__kardata__document_save", call_id: "call_d", args: JSON.stringify({ path: "summary.md" }) },
        ]),
      ].join("\n"),
    );
    const out = await runReader(root, "sess-2");
    expect(out.searches).toHaveLength(1);
    expect(out.searches[0]).toMatchObject({ result_count: 0, results: [], area: "other" });
  });
});
