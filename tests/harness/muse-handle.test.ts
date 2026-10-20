import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MuseHandle } from "../../src/harness/muse.js";
import type { HarnessEvent } from "../../src/harness/types.js";

function stub(script: string) {
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", () => {});
  return child;
}

describe("MuseHandle terminal grace", () => {
  it("stops a run that lingers after its terminal event", async () => {
    const child = stub(
      'console.log(JSON.stringify({payload_type:"run.terminal.completed",payload:{text:"done"}}));' +
        "setInterval(() => {}, 1000);",
    );
    const handle = new MuseHandle(child, 5000, { terminalGraceMs: 200 });
    const events: HarnessEvent[] = [];
    const draining = (async () => {
      for await (const event of handle.events) events.push(event);
    })();
    const result = await handle.wait();
    await draining;
    expect(events.some((e) => e.type === "finished")).toBe(true);
    const stall = events.find((e) => e.type === "error");
    expect((stall as { message?: string } | undefined)?.message).toMatch(/200ms \(stall\)/);
    // wait() resolved: the lingering child was reaped.
    expect(typeof result.exitCode).toBe("number");
  }, 15_000);

  it("stays off when the stall timeout is 0", async () => {
    const child = stub(
      'console.log(JSON.stringify({payload_type:"run.terminal.completed",payload:{text:"done"}}));' +
        "setTimeout(() => {}, 1500);",
    );
    const handle = new MuseHandle(child, 0);
    const events: HarnessEvent[] = [];
    const draining = (async () => {
      for await (const event of handle.events) events.push(event);
    })();
    const result = await handle.wait();
    await draining;
    expect(result.exitCode).toBe(0);
    expect(events.some((e) => e.type === "error")).toBe(false);
  }, 15_000);

  it("does not fire before the stall timeout without a terminal", async () => {
    const child = stub(
      'console.log(JSON.stringify({payload_type:"run.usage",payload:{calls:1,models:[{model:"m",input_tokens:1,output_tokens:2,cached_tokens:0,reasoning_tokens:3}]}}));',
    );
    const handle = new MuseHandle(child, 5000, { terminalGraceMs: 200 });
    const events: HarnessEvent[] = [];
    const draining = (async () => {
      for await (const event of handle.events) events.push(event);
    })();
    const result = await handle.wait();
    await draining;
    expect(result.exitCode).toBe(0);
    expect(result.usage).toMatchObject({ inputTokens: 1, reasoningTokens: 3, calls: 1 });
    expect(events.some((e) => e.type === "error")).toBe(false);
  }, 15_000);
});
