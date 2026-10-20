import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "./db/client.js";
import { createAgentRunner } from "./runs/agent-runner.js";
import { createJobRunner, realJobDeps } from "./runs/bulk.js";
import { buildResearchPrompt } from "./runs/prompt.js";
import {
  AGENTS_GATEWAY,
  checkAppMuseVersion,
  probeInstalledMuseVersion,
} from "./harness/setup.js";
import { loadDotenv, requireEnv } from "./lib/env.js";
import { OPERATOR_AUTH, type AuthContext } from "./mcp/auth.js";
import { createMcpServer } from "./mcp/server.js";
import { authenticateRunToken } from "./runs/tokens.js";
import { createRunner } from "./runs/runner.js";

export interface ServerHandle {
  url: string;
  hosts: string[];
  /** One URL per listener (ports differ when port 0 is used). */
  urls: string[];
  close: () => Promise<void>;
}

/** HOST accepts a comma list (e.g. "127.0.0.1,172.31.250.1"). Never 0.0.0.0. */
export function parseHosts(raw: string): string[] {
  const hosts = raw
    .split(",")
    .map((h) => h.trim())
    .filter((h) => h !== "");
  if (hosts.length === 0) throw new Error("HOST must name at least one address");
  return hosts;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleHealthz(db: Db, res: ServerResponse): Promise<void> {
  try {
    await db.execute(sql`SELECT 1`);
    sendJson(res, 200, { ok: true, db: true });
  } catch {
    sendJson(res, 503, { ok: false, db: false });
  }
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

export async function startServer(opts: {
  host: string;
  port: number;
  db: Db;
  operatorToken: string;
  onClose?: () => Promise<void>;
}): Promise<ServerHandle> {
  const hosts = parseHosts(opts.host);
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "GET" && path === "/healthz") {
        await handleHealthz(opts.db, res);
        return;
      }
      if (path === "/mcp") {
        await handleMcp(req, res, opts.db, opts.operatorToken);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("internal error");
      }
    });
  };
  // One listener per address: Node does not bind a list.
  const servers = hosts.map((host) => {
    const server = createServer(onRequest);
    const sockets = new Set<Socket>();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    });
    return { host, server, sockets };
  });
  for (const { host, server } of servers) {
    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(opts.port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  }
  const urls = servers.map(({ host, server }) => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : opts.port;
    return `http://${host}:${port}`;
  });
  return {
    url: urls[0] as string,
    hosts,
    urls,
    close: async () => {
      for (const { sockets } of servers) {
        for (const socket of sockets) socket.destroy();
      }
      for (const { server } of servers) {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
      await opts.onClose?.();
    },
  };
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  operatorToken: string,
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST", "content-type": "text/plain" });
    res.end("method not allowed");
    return;
  }
  const authorization = req.headers.authorization ?? "";
  let auth: AuthContext = OPERATOR_AUTH;
  if (authorization === `Bearer ${operatorToken}`) {
    auth = OPERATOR_AUTH;
  } else if (authorization.startsWith("Bearer ")) {
    const scope = await authenticateRunToken(db, authorization.slice("Bearer ".length));
    if (!scope) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    auth = { kind: "run", runId: scope.runId, companyId: scope.companyId };
  } else {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message });
      return;
    }
    throw err;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcp = createMcpServer(db, auth);
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function main(): Promise<void> {
  loadDotenv();
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "8787");
  const museVersion = checkAppMuseVersion(
    process.env.KARDATA_MUSE_VERSION,
    probeInstalledMuseVersion(),
  );
  if (museVersion.ok) {
    console.log(`app Muse ${museVersion.installed} matches KARDATA_MUSE_VERSION`);
  } else {
    console.warn(
      `agent runs disabled: app Muse is ${museVersion.installed ?? "unknown"} ` +
        `(want ${museVersion.expected ?? "unset KARDATA_MUSE_VERSION"}); ` +
        `run npm run harness:setup`,
    );
  }
  const { db, close: closeDb } = createDb(requireEnv("DATABASE_URL"));
  const runner = createRunner(db);
  const handle = await startServer({
    host,
    port,
    db,
    operatorToken: requireEnv("KARDATA_OPERATOR_TOKEN"),
    onClose: closeDb,
  });
  const serverPort = new URL(handle.url).port;
  if (!handle.hosts.includes(AGENTS_GATEWAY)) {
    console.warn(
      `agent runs need the ${AGENTS_GATEWAY} listener (HOST=${host}); ` +
        `containers reach MCP at http://${AGENTS_GATEWAY}:${serverPort}/mcp`,
    );
  }
  const agentRunner = createAgentRunner(db, {
    mcpUrl: `http://${AGENTS_GATEWAY}:${serverPort}/mcp`,
    buildPrompt: buildResearchPrompt,
  });
  // Agent recovery first: it stops orphaned containers and revokes their
  // tokens before the collect runner fails leftover running rows.
  await agentRunner.start();
  await runner.start();
  const jobRunner = createJobRunner(db, realJobDeps(db));
  await jobRunner.start();
  process.on("SIGTERM", () => {
    void (async () => {
      await jobRunner.stop();
      await agentRunner.stop();
      await runner.stop();
      await handle.close();
      process.exit(0);
    })().catch(() => process.exit(1));
  });
  console.log(`kardata-server listening on ${handle.url}`);
}

const argv1 = process.argv[1];
const isMain = argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
