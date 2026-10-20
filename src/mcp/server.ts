import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../db/client.js";
import { registerResearchTools } from "./research-tools.js";
import { registerTools } from "./tools.js";

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({ name: "kardata-server", version: "2.0.0" });
  registerTools(server, db);
  registerResearchTools(server, db);
  return server;
}
