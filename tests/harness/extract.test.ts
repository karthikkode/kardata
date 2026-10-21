import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTRACT_PROMPT_FILE,
  EXTRACT_SCHEMA_FILE,
  extractRunArgs,
  prepareExtractInput,
} from "../../src/harness/extract.js";

describe("extractRunArgs", () => {
  it("invokes a tool-less container with no MCP config and no secrets", () => {
    const args = extractRunArgs({ runId: "abc", area: "marketing", inputDir: "/tmp/in" });
    const joined = args.join(" ");
    expect(joined).toContain("--disable-web-tools");
    expect(joined).toContain("--disable-shell");
    expect(joined).toContain("--disable-write");
    expect(joined).toContain("--output-schema");
    expect(joined).toContain(",ro");
    expect(joined).not.toContain("--mcp-config");
    expect(joined).not.toContain("--allow-write");
    expect(joined).not.toContain("KARDATA_MCP_AUTH");
    expect(joined).not.toContain("KARDATA_RUN_TOKEN");
  });

  it("refuses a missing input dir", () => {
    expect(() => extractRunArgs({ runId: "abc", area: "marketing", inputDir: "" })).toThrow(
      "input dir",
    );
  });

  it("writes world-readable input files for the container user", async () => {
    const input = await prepareExtractInput("prompt", "{}");
    try {
      for (const file of [input.dir, join(input.dir, EXTRACT_PROMPT_FILE), join(input.dir, EXTRACT_SCHEMA_FILE)]) {
        const mode = (await stat(file)).mode & 0o777;
        expect(mode & 0o044, file).toBe(0o044);
      }
    } finally {
      await input.cleanup();
    }
  });
});
