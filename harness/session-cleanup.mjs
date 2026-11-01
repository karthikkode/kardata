#!/usr/bin/env node
/**
 * Muse session cleanup inside the kardata_muse volume (host entrypoint:
 * src/harness/session-cleanup.ts). The volume is every agent container's
 * HOME; Muse session logs under .local/share/muse/sessions are never
 * removed by Muse itself and grow without bound.
 *
 * Modes (roots are explicit so this is testable outside Docker):
 *   node session-cleanup.mjs sessions <sessionsRoot> <sessionId...>
 *       Delete those sessions' directories (after their run finished and
 *       usage/ingest have read them).
 *   node session-cleanup.mjs prune <sessionsRoot> <homeDir> <maxAgeDays>
 *       Delete session dirs and cache entries older than maxAgeDays
 *       (leftovers from crashed runs).
 *   node session-cleanup.mjs stat <volumeRoot>
 *       Print the volume's used bytes.
 *
 * Hard rules: only ever delete inside the sessions root or the home cache
 * dir; never touch the Muse install (bin/) or .config/muse/auth.json.
 * Prints one JSON line.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function dirBytes(path) {
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const cur = stack.pop();
    let st;
    try {
      st = statSync(cur);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      let entries = [];
      try {
        entries = readdirSync(cur);
      } catch {
        entries = [];
      }
      for (const e of entries) stack.push(join(cur, e));
    } else if (st.isFile()) {
      total += st.size;
    }
  }
  return total;
}

function newestMtime(path) {
  let newest = 0;
  const stack = [path];
  while (stack.length > 0) {
    const cur = stack.pop();
    let st;
    try {
      st = statSync(cur);
    } catch {
      continue;
    }
    // File mtimes only: creating a file bumps its parent dir's mtime,
    // which would make every fresh fixture (and recently-touched tree)
    // look alive.
    if (st.isFile() && st.mtimeMs > newest) newest = st.mtimeMs;
    if (st.isDirectory()) {
      let entries = [];
      try {
        entries = readdirSync(cur);
      } catch {
        entries = [];
      }
      for (const e of entries) stack.push(join(cur, e));
    }
  }
  return newest;
}

/** Session dirs live at <root>/YYYY/MM/DD/<sessionId>. */
function findSessionDirs(root, sessionId) {
  const found = [];
  if (!existsSync(root)) return found;
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name === sessionId) found.push(p);
      else if (depth < 3) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

function deleteInside(root, target) {
  const r = resolve(root);
  const t = resolve(target);
  if (t !== r && !t.startsWith(r + sep)) return 0;
  if (!existsSync(t)) return 0;
  const bytes = dirBytes(t);
  rmSync(t, { recursive: true, force: true });
  return bytes;
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "sessions") {
    const [root, ...ids] = rest;
    if (!root) throw new Error("usage: sessions <sessionsRoot> <sessionId...>");
    let bytesFreed = 0;
    const deleted = [];
    for (const id of ids) {
      if (!SESSION_ID.test(id ?? "")) continue;
      for (const dir of findSessionDirs(root, id)) {
        bytesFreed += deleteInside(root, dir);
        deleted.push(id);
      }
    }
    console.log(JSON.stringify({ mode, deleted, bytesFreed }));
    return;
  }
  if (mode === "prune") {
    const [root, homeDir, daysRaw] = rest;
    const days = Number(daysRaw ?? "1");
    if (!root || !homeDir || !Number.isFinite(days) || days < 0) {
      throw new Error("usage: prune <sessionsRoot> <homeDir> <maxAgeDays>");
    }
    const cutoff = Date.now() - days * 86_400_000;
    let bytesFreed = 0;
    let deleted = 0;
    // Session dirs: prune by newest file inside (a live run keeps writing).
    const pruneTree = (base) => {
      if (!existsSync(base)) return;
      const stack = [base];
      while (stack.length > 0) {
        const dir = stack.pop();
        let entries = [];
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const p = join(dir, e.name);
          // Leaf session dirs sit at depth 3 (YYYY/MM/DD/<id>); treat any
          // dir whose name looks like a session id as a leaf.
          if (SESSION_ID.test(e.name) && e.name.length >= 8 && newestMtime(p) < cutoff) {
            bytesFreed += deleteInside(base, p);
            deleted += 1;
          } else {
            stack.push(p);
          }
        }
      }
    };
    pruneTree(root);
    // Cache: prune top-level entries older than the cutoff.
    const cacheDir = join(homeDir, ".cache");
    if (existsSync(cacheDir)) {
      for (const e of readdirSync(cacheDir, { withFileTypes: true })) {
        const p = join(cacheDir, e.name);
        if (newestMtime(p) < cutoff) {
          bytesFreed += deleteInside(cacheDir, p);
          deleted += 1;
        }
      }
    }
    console.log(JSON.stringify({ mode, deleted, bytesFreed }));
    return;
  }
  if (mode === "stat") {
    const [root] = rest;
    if (!root) throw new Error("usage: stat <volumeRoot>");
    console.log(JSON.stringify({ mode, volumeUsedBytes: existsSync(root) ? dirBytes(root) : 0 }));
    return;
  }
  throw new Error(`unknown mode "${mode ?? ""}" (want sessions|prune|stat)`);
}

try {
  main();
} catch (err) {
  console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
}
