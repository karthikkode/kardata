import { describe, expect, it } from "vitest";
import { classifyRunArgs } from "../../src/harness/classify.js";

describe("classifyRunArgs", () => {
  it("runs muse-spark-1.3 in contributor mode at medium effort, tool-less", () => {
    const joined = classifyRunArgs({ runId: "abc", inputDir: "/tmp/in" }).join(" ");
    expect(joined).toContain("--model muse-spark-1.3");
    expect(joined).toContain("--contributor-mode on");
    expect(joined).toContain("--reasoning-effort medium");
    expect(joined).toContain("--disable-web-tools");
    expect(joined).not.toContain("--mcp-config");
    expect(joined).not.toContain("KARDATA_RUN_TOKEN");
  });
});
