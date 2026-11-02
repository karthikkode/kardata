import { expect, it } from "vitest";
import { codexExtractArgs, CODEX_MODEL, CODEX_CONTEXT } from "../../src/harness/codex-config.js";

it("pins the requested model/context/effort and isolates app-owned auth", () => {
  const args = codexExtractArgs({ runId: "synthetic", area: "ops_read", inputDir: "/tmp/synthetic" });
  expect(args).toContain(CODEX_MODEL);
  expect(args).toContain(`model_context_window=${CODEX_CONTEXT}`);
  expect(args).toContain('model_reasoning_effort="medium"');
  expect(args).toContain('forced_login_method="chatgpt"');
  expect(args.filter((x) => x.includes(":/opt/"))).toEqual(["kardata_codex:/opt/codex"]);
  expect(args.join(" ")).not.toMatch(/kardata_muse|OPENAI_API_KEY|KARDATA_MCP_AUTH|\.codex\/auth/);
  expect(args).toContain("type=bind,src=/tmp/synthetic,dst=/input,ro");
  for (const disabled of ["shell_tool", "multi_agent", "hooks"]) expect(args).toContain(disabled);
  expect(args).toContain('web_search="disabled"');
  expect(args).toContain("mcp_servers={}");
  expect(args).toContain("--ephemeral");
  expect(args).toContain("--read-only");
});
it("refuses an absent input mount", () => {
  expect(() => codexExtractArgs({ runId: "test", area: "ops_read", inputDir: "" })).toThrow("input directory");
});
