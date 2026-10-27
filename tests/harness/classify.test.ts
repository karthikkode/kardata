import { describe, expect, it } from "vitest";
import { CLASSIFY_MUSE_ARGS, classifyRunArgs } from "../../src/harness/classify.js";

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

  it("keeps Muse's web tools on only for the web fallback, with room for a few pages", () => {
    const web = classifyRunArgs({ runId: "abc", inputDir: "/tmp/in", web: true }).join(" ");
    expect(web).not.toContain("--disable-web-tools");
    expect(web).toContain("--max-model-steps 10");
    expect(web).toContain("--disable-shell");
    expect(web).toContain("--disable-write");
    expect(web).toContain("--contributor-mode on");
    expect(web).toContain("--reasoning-effort medium");
    expect(web).not.toContain("--mcp-config");
    expect(CLASSIFY_MUSE_ARGS).toContain("--disable-web-tools");
    expect(classifyRunArgs({ runId: "abc", inputDir: "/tmp/in" }).join(" ")).toContain("--max-model-steps 3");
  });

  it("names parallel calls of one run apart, keeping the run label", () => {
    const a = classifyRunArgs({ runId: "abc", inputDir: "/tmp/in", callKey: "v1-a0" });
    const b = classifyRunArgs({ runId: "abc", inputDir: "/tmp/in", callKey: "v2-a0" });
    const name = (args: string[]) => args[args.indexOf("--name") + 1];
    expect(name(a)).toBe("kardata-classify-abc-v1-a0");
    expect(name(a)).not.toBe(name(b));
    expect(a.join(" ")).toContain("=abc");
  });
});
