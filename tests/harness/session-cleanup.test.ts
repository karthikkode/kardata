import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanupRunSessions,
  sessionCleanupRunArgs,
  sessionPruneRunArgs,
  volumeStatRunArgs,
} from "../../src/harness/session-cleanup.js";

const SCRIPT = resolve("harness/session-cleanup.mjs");

describe("session cleanup run args", () => {
  it("mounts the volume read-write with no network and passes session ids", () => {
    const args = sessionCleanupRunArgs(["abc-123"]);
    expect(args).toContain("kardata_muse:/opt/muse");
    expect(args).toContain("--network");
    expect(args).toContain("/usr/local/bin/session-cleanup.mjs");
    expect(args[args.length - 1]).toBe("abc-123");
    expect(args.join(" ")).not.toContain("auth.json");
  });

  it("prune and stat use the same volume", () => {
    expect(sessionPruneRunArgs()).toContain("prune");
    expect(volumeStatRunArgs()).toContain("kardata_muse:/opt/muse");
  });

  it("does not call docker without session ids", async () => {
    let called = false;
    const out = await cleanupRunSessions([undefined, ""], async () => {
      called = true;
      return { ok: true, stdout: "{}" };
    });
    expect(called).toBe(false);
    expect(out.ok).toBe(true);
  });
});

describe("session-cleanup.mjs against a fixture volume", () => {
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "muse-vol-"));
    const home = join(root, "home");
    const sessions = join(home, ".local/share/muse/sessions");
    const day = join(sessions, "2026", "11", "01");
    for (const id of ["aaaaaaaa-1111", "bbbbbbbb-2222"]) {
      mkdirSync(join(day, id), { recursive: true });
      writeFileSync(join(day, id, "session.jsonl"), "{\"big\":true}\n".repeat(10));
    }
    mkdirSync(join(home, ".config/muse"), { recursive: true });
    writeFileSync(join(home, ".config/muse/auth.json"), "{\"providers\":{}}");
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "muse"), "#!/bin/sh\n");
    mkdirSync(join(home, ".cache/old-cache"), { recursive: true });
    writeFileSync(join(home, ".cache/old-cache", "blob"), "x".repeat(64));
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(join(home, ".cache/old-cache", "blob"), twoDaysAgo, twoDaysAgo);
    utimesSync(join(day, "bbbbbbbb-2222", "session.jsonl"), twoDaysAgo, twoDaysAgo);
    return { root, home, sessions, day };
  }

  function run(args: string[]): { deleted?: unknown; bytesFreed?: number; volumeUsedBytes?: number } {
    const out = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return JSON.parse(out) as { deleted?: unknown; bytesFreed?: number; volumeUsedBytes?: number };
  }

  it("deletes only the named run's session; auth.json and install survive", () => {
    const f = fixture();
    const out = run(["sessions", f.sessions, "aaaaaaaa-1111"]);
    expect(out.bytesFreed).toBeGreaterThan(0);
    expect(existsSync(join(f.day, "aaaaaaaa-1111"))).toBe(false);
    expect(existsSync(join(f.day, "bbbbbbbb-2222"))).toBe(true);
    expect(existsSync(join(f.home, ".config/muse/auth.json"))).toBe(true);
    expect(existsSync(join(f.root, "bin", "muse"))).toBe(true);
  });

  it("prune removes day-old leftovers and keeps fresh files, auth and install", () => {
    const f = fixture();
    run(["prune", f.sessions, f.home, "1"]);
    expect(existsSync(join(f.day, "bbbbbbbb-2222"))).toBe(false);
    expect(existsSync(join(f.day, "aaaaaaaa-1111"))).toBe(true);
    expect(existsSync(join(f.home, ".cache/old-cache"))).toBe(false);
    expect(existsSync(join(f.home, ".config/muse/auth.json"))).toBe(true);
    expect(existsSync(join(f.root, "bin", "muse"))).toBe(true);
  });

  it("stat reports used bytes", () => {
    const f = fixture();
    const out = run(["stat", f.root]);
    expect(out.volumeUsedBytes).toBeGreaterThan(0);
  });
});
