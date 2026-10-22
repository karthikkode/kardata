import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

let child: ChildProcess | undefined;

beforeAll(() => {
  const built = spawnSync("npm", ["run", "build"], { cwd: process.cwd(), stdio: "pipe" });
  if (built.status !== 0) {
    throw new Error(`npm run build failed:\n${built.stderr?.toString() ?? ""}`);
  }
});

afterAll(() => {
  child?.kill("SIGKILL");
  child = undefined;
});

async function waitForPort(readStdout: () => string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  for (;;) {
    const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(readStdout());
    if (match?.[1]) return match[1];
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for the listening port");
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("service shutdown", () => {
  it("exits 0 within 5s on SIGTERM", async () => {
    // Spawn the built server (what the systemd unit runs) as a direct child
    // so SIGTERM reaches node itself. Point it at the TEST database: with
    // the dev DB it would run crash recovery against live runs and tick
    // real runners alongside the dev server.
    const testDb = process.env.TEST_DATABASE_URL;
    if (!testDb) throw new Error("TEST_DATABASE_URL is not set");
    // Start from an empty test DB: earlier files leave queued rows behind,
    // which the child would claim and really execute, stalling its shutdown
    // past the 5s window (files run sequentially, so the reset is safe).
    const dbHandle = getTestDb();
    await ensureMigrated(dbHandle);
    await resetTestDb(dbHandle);
    await dbHandle.close();
    child = spawn(process.execPath, [join(process.cwd(), "dist/server.js")], {
      cwd: process.cwd(),
      // Ephemeral port: never a fixed one (a dev server may hold 8788).
      env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DATABASE_URL: testDb },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const spawned = child;
    let stderr = "";
    let stdout = "";
    spawned.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    spawned.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    const port = await waitForPort(() => stdout, 30000);
    await waitForHealth(`http://127.0.0.1:${port}/healthz`, 30000);
    expect(spawned.exitCode, `server died during boot: ${stderr}`).toBeNull();
    const started = Date.now();
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      spawned.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      spawned.kill("SIGTERM");
    });
    child = undefined;
    expect(exitCode, `server did not exit within 5s of SIGTERM: ${stderr}`).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 60000);
});
