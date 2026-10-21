#!/usr/bin/env node
// Reads per-provider-call records from an app-Muse session dir in the
// kardata_muse volume (main session plus subagent children). Each provider
// goal_usage_attribution record becomes one call; responses pair ordinally
// (k-th provider usage with k-th model_response_created, sanity-checked by
// sequence proximity) and carry the committed assistant text + tool calls.
// Prints {calls: [...], model, note?} as JSON; always exits 0.
import fs from "node:fs";
import path from "node:path";

const PAIR_SEQ_WINDOW = 100;

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function findSessionDir(root, sessionId) {
  for (const y of listDirs(root)) {
    for (const m of listDirs(path.join(root, y))) {
      for (const d of listDirs(path.join(root, y, m))) {
        const candidate = path.join(root, y, m, d, sessionId);
        try {
          if (fs.statSync(candidate).isDirectory()) return candidate;
        } catch {
          /* not here */
        }
      }
    }
  }
  return null;
}

function collectLogs(dir, out) {
  for (const name of listDirs(dir)) {
    const full = path.join(dir, name);
    const log = path.join(full, "session.jsonl");
    try {
      if (fs.statSync(log).isFile()) out.push(log);
    } catch {
      /* not a session dir */
    }
    collectLogs(full, out);
  }
  return out;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readAt(record) {
  if (typeof record.recorded_at === "string") return record.recorded_at;
  if (typeof record.recorded_at === "number" && Number.isFinite(record.recorded_at)) {
    return new Date(Math.floor(record.recorded_at / 1000)).toISOString();
  }
  return null;
}

const FETCH_SNIPPET_CHARS = 2000;

function buildSearches(webCalls, webResults, area) {
  const searches = [];
  for (const [callId, call] of webCalls) {
    const text = webResults.get(callId);
    if (call.name === "web_search") {
      let query = null;
      try {
        query = JSON.parse(call.args || "{}").query;
      } catch {
        /* fall through to null */
      }
      let results = [];
      if (typeof text === "string") {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed.results)) {
            results = parsed.results.map((res, i) => ({
              url: typeof res.url === "string" ? res.url : "",
              title: typeof res.title === "string" ? res.title : null,
              snippet: typeof res.snippet === "string" ? res.snippet : null,
              rank: i,
            }));
          }
          if (typeof query !== "string" && typeof parsed.query === "string") query = parsed.query;
        } catch {
          /* unparseable result: no rows */
        }
      }
      searches.push({
        call_id: callId,
        tool: "web_search",
        query_or_url: typeof query === "string" ? query : "",
        results,
        result_count: results.length,
        at: call.at,
        area,
      });
    } else {
      let url = "";
      try {
        const parsed = JSON.parse(call.args || "{}").url;
        if (typeof parsed === "string") url = parsed;
      } catch {
        /* fall through to empty */
      }
      const results =
        typeof text === "string" && text
          ? [{ url, title: null, snippet: text.slice(0, FETCH_SNIPPET_CHARS), rank: 0 }]
          : [];
      searches.push({
        call_id: callId,
        tool: "web_fetch",
        query_or_url: url,
        results,
        result_count: results.length,
        at: call.at,
        area,
      });
    }
  }
  return searches;
}

function innerEvent(record) {
  const p = record.payload || {};
  if (p.event && p.event.event) return p.event.event;
  return p.event || p;
}

function parseFile(logPath, sessionId, childSessionId) {
  const text = fs.readFileSync(logPath, "utf8");
  const usages = [];
  const responses = [];
  const messages = new Map();
  const toolCalls = new Map();
  const webCalls = new Map();
  const webResults = new Map();
  const areaVotes = new Map();
  let model = null;
  let provider = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const inner = innerEvent(r);
    const kind = inner.kind || "";
    const meta =
      (inner.command && inner.command.session_metadata) ||
      (inner.record && inner.record.command && inner.record.command.session_metadata) ||
      null;
    if (!model) {
      const found = inner.model_id || inner.model || (meta && meta.model_id) || null;
      model = typeof found === "string" ? found : null;
    }
    if (!provider) {
      const found = (meta && meta.provider_id) || null;
      provider = typeof found === "string" ? found : null;
    }
    if (kind === "goal_usage_attribution") {
      const rec = inner.record || {};
      if (rec.usage_family !== "provider") continue;
      const q = rec.quantity || {};
      let at = null;
      if (typeof r.recorded_at === "string") at = r.recorded_at;
      else if (typeof r.recorded_at === "number" && Number.isFinite(r.recorded_at)) {
        // Microseconds since epoch.
        at = new Date(Math.floor(r.recorded_at / 1000)).toISOString();
      }
      usages.push({
        usage_id: typeof rec.usage_id === "string" ? rec.usage_id : null,
        seq: num(r.sequence),
        at,
        input_tokens: num(q.input_tokens),
        output_tokens: num(q.output_tokens),
        cached_tokens: num(q.cached_tokens),
        reasoning_tokens: num(q.reasoning_tokens),
      });
    } else if (kind === "model_response_created") {
      if (typeof inner.response_id === "string") responses.push({ seq: num(r.sequence), id: inner.response_id });
    } else if (kind === "assistant_message_committed") {
      if (typeof inner.response_id !== "string" || typeof inner.text !== "string") continue;
      const list = messages.get(inner.response_id) || [];
      list.push({ phase: typeof inner.phase === "string" ? inner.phase : null, text: inner.text });
      messages.set(inner.response_id, list);
    } else if (kind === "assistant_tool_calls_committed") {
      if (typeof inner.response_id !== "string" || !Array.isArray(inner.tool_calls)) continue;
      const list = toolCalls.get(inner.response_id) || [];
      for (const c of inner.tool_calls) {
        if (c && typeof c.name === "string") {
          list.push({ name: c.name, call_id: typeof c.call_id === "string" ? c.call_id : null });
          if (c.name === "web_search" || c.name === "web_fetch") {
            webCalls.set(c.call_id, {
              name: c.name,
              args: typeof c.args === "string" ? c.args : null,
              at: readAt(r),
            });
          } else if (c.name === "mcp__kardata__area_status_set" && typeof c.args === "string") {
            try {
              const area = JSON.parse(c.args).area;
              if (typeof area === "string" && area) {
                areaVotes.set(area, (areaVotes.get(area) || 0) + 1);
              }
            } catch {
              /* unparseable args vote nothing */
            }
          } else if (c.name === "mcp__kardata__document_save" && typeof c.args === "string") {
            try {
              const path = String(JSON.parse(c.args).path || "");
              // Area is the first folder, else "other" (mirrors document_save).
              const area = path.includes("/") ? path.split("/")[0] : "other";
              if (area) areaVotes.set(area, (areaVotes.get(area) || 0) + 1);
            } catch {
              /* unparseable args vote nothing */
            }
          }
        }
      }
      toolCalls.set(inner.response_id, list);
    } else if (kind === "tool_result_batch_committed") {
      const results = inner.results;
      if (!Array.isArray(results)) continue;
      for (const res of results) {
        if (res && typeof res.tool_call_id === "string" && typeof res.text === "string") {
          webResults.set(res.tool_call_id, res.text);
        }
      }
    }
  }
  usages.sort((a, b) => a.seq - b.seq);
  responses.sort((a, b) => a.seq - b.seq);
  const calls = usages.map((u, i) => {
    const peer = responses[i] || null;
    const responseId = peer && Math.abs(peer.seq - u.seq) <= PAIR_SEQ_WINDOW ? peer.id : null;
    return {
      usage_id: u.usage_id,
      session_id: sessionId,
      child_session_id: childSessionId,
      seq: u.seq,
      response_id: responseId,
      model,
      provider,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cached_tokens: u.cached_tokens,
      reasoning_tokens: u.reasoning_tokens,
      at: u.at,
      messages: responseId ? messages.get(responseId) || [] : [],
      tool_calls: responseId ? toolCalls.get(responseId) || [] : [],
    };
  });
  let area = null;
  let best = 0;
  for (const [name, votes] of areaVotes) {
    if (votes > best) {
      area = name;
      best = votes;
    }
  }
  const searches = buildSearches(webCalls, webResults, area).map((s) => ({
    ...s,
    child_session_id: childSessionId,
  }));
  return { calls, model, searches };
}

function main() {
  const sessionId = process.argv[2];
  const home = process.env.HOME || "/opt/muse/home";
  const root = process.argv[3] || path.join(home, ".local/share/muse/sessions");
  if (!sessionId) {
    console.log(JSON.stringify({ calls: [], model: null, note: "usage: session-reader.mjs <sessionId> [sessionsRoot]" }));
    return;
  }
  const dir = findSessionDir(root, sessionId);
  if (!dir) {
    console.log(JSON.stringify({ calls: [], model: null, note: `session not found: ${sessionId}` }));
    return;
  }
  const calls = [];
  const searches = [];
  let model = null;
  const files = [path.join(dir, "session.jsonl"), ...collectLogs(dir, [])];
  for (const file of files) {
    try {
      const childId = path.dirname(file) === dir ? null : path.basename(path.dirname(file));
      const parsed = parseFile(file, sessionId, childId);
      if (!model && parsed.model) model = parsed.model;
      for (const c of parsed.calls) calls.push(c);
      for (const s of parsed.searches || []) searches.push(s);
    } catch {
      // Files that fail to parse contribute nothing.
    }
  }
  console.log(JSON.stringify({ calls, model, searches }));
}

main();
