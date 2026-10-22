/**
 * Standard operator path: call one MCP tool on a running kardata-server and
 * print the result as JSON. All pipeline operations go through here (or any
 * MCP client) — never through one-off scripts against the database.
 *
 * Usage:
 *   npx tsx scripts/mcp-call.ts <tool> '<json-args>' [url] [token]
 * Defaults: KARDATA_MCP_URL (else http://127.0.0.1:8787/mcp),
 * KARDATA_OPERATOR_TOKEN from .env.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadDotenv } from "../src/lib/env.js";

async function main(): Promise<void> {
  const [, , tool, argsJson, urlArg, tokenArg] = process.argv;
  if (!tool) {
    console.error("usage: npx tsx scripts/mcp-call.ts <tool> '<json-args>' [url] [token]");
    process.exit(2);
  }
  loadDotenv();
  const url = urlArg ?? process.env.KARDATA_MCP_URL ?? "http://127.0.0.1:8787/mcp";
  const token = tokenArg ?? process.env.KARDATA_OPERATOR_TOKEN;
  if (!token) {
    console.error("missing operator token: set KARDATA_OPERATOR_TOKEN or pass it");
    process.exit(2);
  }
  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
      console.error("args must be valid JSON");
      process.exit(2);
    }
  }
  const client = new Client({ name: "mcp-call", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  try {
    const result = await client.callTool({ name: tool, arguments: args });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

await main();
