import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../db/client.js";
import { OPERATOR_AUTH, type AuthContext } from "./auth.js";
import { registerResearchTools } from "./research-tools.js";
import { registerBenchmarkTools } from "./benchmark-tools.js";
import { registerEvidenceMiningTools } from "./evidence-mining-tools.js";
import { registerTools } from "./tools.js";
import { registerCallBriefTools } from "./call-brief-tools.js";

export function createMcpServer(db: Db, auth: AuthContext = OPERATOR_AUTH): McpServer {
  const server = new McpServer({ name: "kardata-server", version: "2.0.0" });
  registerTools(server, db, auth);
  registerResearchTools(server, db, auth);
  registerBenchmarkTools(server, db, auth);
  registerEvidenceMiningTools(server, db, auth);
  registerCallBriefTools(server, db, auth);
  return server;
}
