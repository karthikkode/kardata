#!/usr/bin/env node
// Reads per-child usage from an app-Muse session dir in the kardata_muse
// volume. Usage per child = sum of reported provider goal_usage_attribution
// records in subagent/*/session.jsonl (tool-family records carry no tokens).
// Prints {children: [...], note?} as JSON; always exits 0 (failures are notes).
import fs from "node:fs";
import path from "node:path";

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
  // Layout: <root>/YYYY/MM/DD/<sessionId>; view dirs (dotted) are skipped.
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

function parseChild(logPath) {
  const child = {
    sessionId: path.basename(path.dirname(logPath)),
    model: undefined,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    calls: 0,
  };
  let text;
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch {
    return null;
  }
  const seen = new Set();
  let lineno = 0;
  for (const line of text.split("\n")) {
    lineno += 1;
    if (!line.includes("goal_usage_attribution") && !line.includes("run.model.configured")) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.payload_type === "run.model.configured") {
      const modelId = record.payload?.record?.model_id;
      if (child.model === undefined && typeof modelId === "string") child.model = modelId;
      continue;
    }
    const usage = record.payload?.event?.record;
    if (!usage || usage.usage_family !== "provider") continue;
    const qty = usage.quantity;
    if (!qty || qty.reported !== true) continue;
    if (qty.unit !== undefined && qty.unit !== "tokens") continue;
    const key = typeof usage.usage_id === "string" ? usage.usage_id : `#${lineno}`;
    if (seen.has(key)) continue;
    seen.add(key);
    child.inputTokens += num(qty.input_tokens);
    child.outputTokens += num(qty.output_tokens);
    child.cachedTokens += num(qty.cached_tokens);
    child.reasoningTokens += num(qty.reasoning_tokens);
    child.calls += 1;
  }
  if (child.model === undefined) delete child.model;
  return child;
}

function main() {
  const sessionId = process.argv[2];
  const home = process.env.HOME || "/opt/muse/home";
  const root = process.argv[3] || path.join(home, ".local/share/muse/sessions");
  if (!sessionId) {
    console.log(JSON.stringify({ children: [], note: "usage: usage-reader.js <sessionId> [sessionsRoot]" }));
    return;
  }
  const dir = findSessionDir(root, sessionId);
  if (!dir) {
    console.log(JSON.stringify({ children: [], note: `no session dir for ${sessionId} under ${root}` }));
    return;
  }
  const subagentDir = path.join(dir, "subagent");
  try {
    if (!fs.statSync(subagentDir).isDirectory()) throw new Error("not a dir");
  } catch {
    console.log(JSON.stringify({ children: [], note: `no subagent dir for ${sessionId} (no child runs?)` }));
    return;
  }
  const logs = collectLogs(subagentDir, []);
  if (logs.length === 0) {
    console.log(JSON.stringify({ children: [], note: `no subagent session logs for ${sessionId}` }));
    return;
  }
  const children = [];
  for (const log of logs) {
    const child = parseChild(log);
    if (child) children.push(child);
  }
  children.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1));
  if (children.length === 0) {
    console.log(
      JSON.stringify({ children: [], note: `${logs.length} subagent logs found but none parsed` }),
    );
    return;
  }
  console.log(JSON.stringify({ children }));
}

main();
