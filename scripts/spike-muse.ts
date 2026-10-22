/**
 * Stage 3a spike launcher: runs one headless Muse agent with per-run MCP
 * config (kardata streamable-http + Playwright stdio), capturing JSONL events,
 * per-event arrival times (liveness), and peak RSS of the process tree.
 *
 * Usage: npx tsx scripts/spike-muse.ts --prompt "..." [--prompt-file p]
 *        [--run-id id] [--max-model-steps n] [-- muse args...]
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAppEnv } from "../src/lib/env.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** RSS (KB) summed over pid and all descendants, via ps. */
async function treeRssKb(rootPid: number): Promise<number> {
  const { execFile } = await import("node:child_process");
  const ps: string = await new Promise((resolve) => {
    execFile("ps", ["-e", "-o", "pid=,ppid=,rss="], (err, stdout) => resolve(err ? "" : stdout));
  });
  const children = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const line of ps.split("\n")) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    rss.set(pid, kb ?? 0);
    const list = children.get(ppid ?? 0) ?? [];
    list.push(pid);
    children.set(ppid ?? 0, list);
  }
  let total = 0;
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    total += rss.get(pid) ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
}

async function main(): Promise<void> {
  loadAppEnv();
  const token = process.env.KARDATA_OPERATOR_TOKEN?.trim();
  const needsToken = !process.argv.includes("--no-mcp");
  if (needsToken && !token) {
    console.error("KARDATA_OPERATOR_TOKEN is not set (see .env)");
    process.exit(2);
  }
  const runId = arg("--run-id") ?? randomUUID();
  const promptFile = arg("--prompt-file");
  const prompt = promptFile ? readFileSync(promptFile, "utf8") : arg("--prompt");
  if (!prompt) {
    console.error("need --prompt or --prompt-file");
    process.exit(2);
  }
  const maxSteps = arg("--max-model-steps") ?? "10";
  const dashdash = process.argv.indexOf("--");
  const extra = dashdash >= 0 ? process.argv.slice(dashdash + 1) : [];
  const noMcp = process.argv.includes("--no-mcp");

  const repo = process.cwd();
  const workspace = join(repo, "var", "runs", runId);
  mkdirSync(workspace, { recursive: true });
  const playwrightBin = join(repo, "node_modules", ".bin", "playwright-mcp");

  const mcpArgs = noMcp
    ? []
    : [
        "-c",
        `mcpServers.kardata={"url":"http://127.0.0.1:8787/mcp","headers":{"Authorization":"\${KARDATA_MCP_AUTH}"}}`,
        "-c",
        `mcpServers.playwright={"command":${JSON.stringify(playwrightBin)},"args":["--headless","--isolated"]}`,
      ];
  const args = ["exec", "--json", "--max-model-steps", maxSteps, ...mcpArgs, ...extra, prompt];
  console.log(`[spike] run ${runId} workspace ${workspace}`);

  const events = createWriteStream(join(workspace, "events.jsonl"));
  const arrivals = createWriteStream(join(workspace, "arrivals.log"));
  const stderrLog = createWriteStream(join(workspace, "stderr.log"));
  const startedAt = Date.now();

  const child = spawn("muse", args, {
    cwd: workspace,
    env: token ? { ...process.env, KARDATA_MCP_AUTH: `Bearer ${token}` } : { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.stdout || !child.stderr || !child.pid) throw new Error("spawn failed");

  let peakKb = 0;
  const sampler = setInterval(() => {
    void treeRssKb(child.pid as number)
      .then((kb) => {
        if (kb > peakKb) peakKb = kb;
      })
      .catch(() => {});
  }, 500);
  sampler.unref();

  let buf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim() === "") continue;
      events.write(`${line}\n`);
      let type = "?";
      try {
        type = (JSON.parse(line) as { payload_type?: string }).payload_type ?? "?";
      } catch {
        type = "unparsed";
      }
      arrivals.write(`t=${Date.now() - startedAt}ms type=${type} bytes=${line.length}\n`);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => stderrLog.write(chunk));

  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 0));
  });
  clearInterval(sampler);
  // One last sample: peak often lands near the end.
  try {
    peakKb = Math.max(peakKb, await treeRssKb(child.pid as number));
  } catch {
    /* exited already */
  }
  events.end();
  arrivals.end();
  stderrLog.end();
  console.log(`[spike] exit=${exitCode} peakRssKb=${peakKb}`);
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
