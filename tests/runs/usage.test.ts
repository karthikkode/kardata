import { describe, expect, it } from "vitest";
import type { HarnessUsage } from "../../src/harness/types.js";
import type { ChildUsage } from "../../src/db/schema.js";
import { rollupUsage, totalUsage } from "../../src/runs/usage.js";

const MAIN: HarnessUsage = {
  model: "main-model",
  inputTokens: 100,
  outputTokens: 20,
  cachedTokens: 50,
  reasoningTokens: 7,
  calls: 2,
};

const CHILD: ChildUsage = {
  sessionId: "child-1",
  model: "child-model",
  inputTokens: 200,
  outputTokens: 40,
  cachedTokens: 10,
  reasoningTokens: 3,
  calls: 5,
};

describe("totalUsage", () => {
  it("sums main and children", () => {
    expect(totalUsage(MAIN, [CHILD])).toEqual({
      model: "main-model",
      inputTokens: 300,
      outputTokens: 60,
      cachedTokens: 60,
      reasoningTokens: 10,
      calls: 7,
    });
  });

  it("keeps main-only totals when there are no children", () => {
    expect(totalUsage(MAIN, [])).toEqual(MAIN);
  });

  it("adopts the first child model when main is missing", () => {
    const total = totalUsage(undefined, [CHILD]);
    expect(total).toMatchObject({ model: "child-model", inputTokens: 200, calls: 5 });
  });

  it("returns zeros when both are missing", () => {
    expect(totalUsage(undefined, [])).toMatchObject({ inputTokens: 0, calls: 0 });
  });
});

describe("rollupUsage", () => {
  it("passes main through when there is no session id", async () => {
    const rollup = await rollupUsage(MAIN, undefined, async () => {
      throw new Error("reader must not run without a session id");
    });
    expect(rollup.total).toEqual(MAIN);
    expect(rollup.childrenIncluded).toBe(false);
    expect(rollup.note).toMatch(/no session id/);
  });

  it("rolls children into the total", async () => {
    const rollup = await rollupUsage(MAIN, "session-1", async () => ({
      ok: true,
      stdout: JSON.stringify({ children: [CHILD] }),
    }));
    expect(rollup.childrenIncluded).toBe(true);
    expect(rollup.children).toHaveLength(1);
    expect(rollup.total).toMatchObject({ inputTokens: 300, outputTokens: 60, calls: 7 });
  });

  it("says why when the reader finds no children", async () => {
    const rollup = await rollupUsage(MAIN, "session-1", async () => ({
      ok: true,
      stdout: JSON.stringify({ children: [], note: "no subagent dir" }),
    }));
    expect(rollup.total).toEqual(MAIN);
    expect(rollup.childrenIncluded).toBe(false);
    expect(rollup.note).toBe("no subagent dir");
  });

  it("drops malformed child rows", async () => {
    const rollup = await rollupUsage(MAIN, "session-1", async () => ({
      ok: true,
      stdout: JSON.stringify({ children: [{ nope: true }, CHILD, "junk"] }),
    }));
    expect(rollup.childrenIncluded).toBe(true);
    expect(rollup.children).toHaveLength(1);
    expect(rollup.total).toMatchObject({ inputTokens: 300 });
  });

  it("explains a failed reader run", async () => {
    const rollup = await rollupUsage(MAIN, "session-1", async () => ({ ok: false, stdout: "" }));
    expect(rollup.total).toEqual(MAIN);
    expect(rollup.childrenIncluded).toBe(false);
    expect(rollup.note).toMatch(/failed/);
  });

  it("explains invalid reader JSON", async () => {
    const rollup = await rollupUsage(MAIN, "session-1", async () => ({ ok: true, stdout: "not json" }));
    expect(rollup.childrenIncluded).toBe(false);
    expect(rollup.note).toMatch(/invalid JSON/);
  });
});
