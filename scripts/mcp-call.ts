/**
 * Standard operator path: call one MCP tool on a running kardata-server and
 * print the result as JSON. All pipeline operations go through here (or any
 * MCP client) — never through one-off scripts against the database.
 *
 * Usage:
 *   npx tsx scripts/mcp-call.ts <tool> '<json-args>' [url] [token]
 *   npx tsx scripts/mcp-call.ts sector_profile_set --sectorId <id> --json-file docs/sectors/skincare/profile.json
 * --json-file reads a JSON file and passes it as the `profile` arg.
 * Defaults: KARDATA_MCP_URL (else http://127.0.0.1:8787/mcp),
 * KARDATA_OPERATOR_TOKEN from .env.
 */
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadAppEnv } from "../src/lib/env.js";

export function parseToolArgs(argv: string[]): { tool: string; args: Record<string, unknown> } {
  const [tool, ...rest] = argv;
  if (!tool) throw new Error("usage: npx tsx scripts/mcp-call.ts <tool> '<json-args>' [url] [token]");
  const args: Record<string, unknown> = {};
  if (rest.length > 0 && !rest[0]?.startsWith("--")) {
    try {
      Object.assign(args, JSON.parse(rest[0] ?? "{}") as Record<string, unknown>);
    } catch {
      throw new Error("args must be valid JSON");
    }
    return { tool, args };
  }
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag?.startsWith("--")) throw new Error(`unexpected argument "${flag ?? ""}" (want --key value)`);
    const key = flag.slice(2);
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    i += 1;
    if (key === "json-file") {
      try {
        args.profile = JSON.parse(readFileSync(value, "utf8")) as unknown;
      } catch {
        throw new Error(`could not read profile JSON from ${value}`);
      }
    } else {
      args[key] = value;
    }
  }
  return { tool, args };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // [url] [token] positional suffixes only apply to the JSON-args form.
  const flagForm = argv.some((a) => a.startsWith("--"));
  let tool: string;
  let args: Record<string, unknown>;
  let urlArg: string | undefined;
  let tokenArg: string | undefined;
  try {
    if (flagForm) {
      ({ tool, args } = parseToolArgs(argv));
    } else {
      ({ tool, args } = parseToolArgs(argv.slice(0, 2)));
      urlArg = argv[2];
      tokenArg = argv[3];
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  }
  loadAppEnv();
  const url = urlArg ?? process.env.KARDATA_MCP_URL ?? "http://127.0.0.1:8787/mcp";
  const token = tokenArg ?? process.env.KARDATA_OPERATOR_TOKEN;
  if (!token) {
    console.error("missing operator token: set KARDATA_OPERATOR_TOKEN or pass it");
    process.exit(2);
  }
  const client = new Client({ name: "mcp-call", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  try {
    const timeoutMs = process.env.MCP_TIMEOUT_MS ? Number(process.env.MCP_TIMEOUT_MS) : undefined;
    const result = await client.callTool({ name: tool, arguments: args }, undefined, timeoutMs ? { timeout: timeoutMs } : undefined);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1]?.endsWith("mcp-call.ts")) {
  await main();
}
