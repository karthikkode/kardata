import { describe, expect, it } from "vitest";
import {
  CONTAINER_CPUS,
  CONTAINER_MEMORY,
  CONTAINER_PIDS_LIMIT,
  PLAYWRIGHT_SERVER_CONFIG,
  RESEARCH_MUSE_ARGS,
  RUN_LABEL,
  containerNameForRun,
  dockerRunArgs,
  dockerStopArgs,
  playwrightServerConfig,
  recoveryListArgs,
} from "../../src/harness/docker.js";
import { AGENTS_NETWORK, AGENT_IMAGE, MUSE_MOUNT, MUSE_VOLUME, checkAppMuseVersion } from "../../src/harness/setup.js";
import type { HarnessStartOptions } from "../../src/harness/types.js";

const RUN_ID = "9d1f8b3a-0000-4000-8000-aaaaaaaaaaaa";

function fixture(): HarnessStartOptions {
  return {
    runId: RUN_ID,
    workspaceDir: "/unused/in/container",
    prompt: "Say hi.",
    mcpServers: [
      {
        name: "kardata",
        url: "http://host.docker.internal:8787/mcp",
        headers: { Authorization: "${KARDATA_MCP_AUTH}" },
      },
      { name: "playwright", command: "playwright-mcp", args: ["--headless", "--isolated"] },
    ],
    env: { KARDATA_MCP_AUTH: "Bearer secret" },
    limits: { maxModelSteps: 10 },
    extraArgs: ["--disable-shell", "--disable-write"],
  };
}

describe("docker harness", () => {
  it("emits the exact sandboxed docker run", () => {
    expect(dockerRunArgs(fixture())).toEqual([
      "run",
      "--rm",
      "--name",
      `kardata-run-${RUN_ID}`,
      "--label",
      `${RUN_LABEL}=${RUN_ID}`,
      "--memory",
      CONTAINER_MEMORY,
      "--cpus",
      CONTAINER_CPUS,
      "--pids-limit",
      CONTAINER_PIDS_LIMIT,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--tmpfs",
      "/workspace",
      "--network",
      AGENTS_NETWORK,
      "-v",
      `${MUSE_VOLUME}:${MUSE_MOUNT}`,
      "-e",
      "KARDATA_MCP_AUTH=Bearer secret",
      "-e",
      `HOME=${MUSE_MOUNT}/home`,
      "-e",
      "MUSE_NO_AUTO_UPDATE=1",
      "-e",
      "LANG=C.UTF-8",
      AGENT_IMAGE,
      "run",
      "exec",
      "--json",
      "--max-model-steps",
      "10",
      "-c",
      'mcpServers.kardata={"url":"http://host.docker.internal:8787/mcp","headers":{"Authorization":"${KARDATA_MCP_AUTH}"}}',
      "-c",
      'mcpServers.playwright={"command":"playwright-mcp","args":["--headless","--isolated"]}',
      "--disable-shell",
      "--disable-write",
      "Say hi.",
    ]);
  });

  it("mounts only the app Muse volume, never a home directory", () => {
    const args = dockerRunArgs(fixture());
    const mounts = args.filter((a, i) => args[i - 1] === "-v" || args[i - 1] === "--volume");
    expect(mounts).toEqual([`${MUSE_VOLUME}:${MUSE_MOUNT}`]);
    expect(JSON.stringify(args)).not.toContain("/home/");
    expect(JSON.stringify(args)).not.toContain("/root");
  });

  it("passes exactly the four allowed env vars", () => {
    const args = dockerRunArgs(fixture());
    const envs = args.filter((a, i) => args[i - 1] === "-e").map((e) => e.split("=")[0]);
    expect(envs).toEqual(["KARDATA_MCP_AUTH", "HOME", "MUSE_NO_AUTO_UPDATE", "LANG"]);
  });

  it("refuses extra env and missing auth", () => {
    expect(() =>
      dockerRunArgs({ ...fixture(), env: { KARDATA_MCP_AUTH: "x", DATABASE_URL: "y" } }),
    ).toThrow(/extra env/);
    expect(() => dockerRunArgs({ ...fixture(), env: {} })).toThrow(/KARDATA_MCP_AUTH/);
  });

  it("sanitizes the container name", () => {
    expect(containerNameForRun(RUN_ID)).toBe(`kardata-run-${RUN_ID}`);
    expect(containerNameForRun("a/b:c d")).toBe("kardata-run-a-b-c-d");
    expect(() => containerNameForRun("")).toThrow();
  });

  it("stops with SIGTERM then SIGKILL after 10s", () => {
    expect(dockerStopArgs("kardata-run-x")).toEqual(["stop", "-t", "10", "kardata-run-x"]);
  });

  it("lists labeled containers for boot recovery", () => {
    expect(recoveryListArgs()).toEqual(["ps", "-q", "--filter", `label=${RUN_LABEL}`]);
  });

  it("keeps the adopted research config locked down and writable", () => {
    expect(RESEARCH_MUSE_ARGS).toContain("--disable-shell");
    expect(RESEARCH_MUSE_ARGS).toContain("--disable-write");
    const contributor = RESEARCH_MUSE_ARGS.indexOf("--contributor-mode");
    expect(RESEARCH_MUSE_ARGS[contributor + 1]).toBe("on");
    const model = RESEARCH_MUSE_ARGS.indexOf("--model");
    expect(RESEARCH_MUSE_ARGS[model + 1]).toBe("muse-spark-1.3");
    // Without workspace trust Muse offers no subagent tools.
    expect(RESEARCH_MUSE_ARGS).toContain("--trust-workspace");
    expect(RESEARCH_MUSE_ARGS).not.toContain("--yolo");
    expect(PLAYWRIGHT_SERVER_CONFIG.args).toContain("--no-sandbox");
  });

  it("fences Playwright to semicolon-joined origins, or leaves it unfenced", () => {
    const fenced = playwrightServerConfig(["https://shop.example", "http://shop.example"]);
    const at = (fenced.args ?? []).indexOf("--allowed-origins");
    expect((fenced.args ?? [])[at + 1]).toBe("https://shop.example;http://shop.example");
    expect(fenced.args).toContain("--no-sandbox");
    expect(playwrightServerConfig([]).args).toEqual(PLAYWRIGHT_SERVER_CONFIG.args);
  });

  it("gates agent runs on the version pin", () => {
    expect(checkAppMuseVersion("1.4.11-R6667.1", "Muse Code 1.4.11 (1.4.11-R6667.1)\n")).toEqual({
      ok: true,
      installed: "1.4.11-R6667.1",
      expected: "1.4.11-R6667.1",
    });
    const mismatch = checkAppMuseVersion("0.0.0", "Muse Code 1.4.11 (1.4.11-R6667.1)\n");
    expect(mismatch.ok).toBe(false);
    expect(checkAppMuseVersion(undefined, "").ok).toBe(false);
    expect(checkAppMuseVersion("1.4.11-R6667.1", "garbage\n").ok).toBe(false);
  });
});
