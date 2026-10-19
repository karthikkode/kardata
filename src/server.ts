import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "./db/client.js";
import { loadDotenv, requireEnv } from "./lib/env.js";
import { createMcpServer } from "./mcp/server.js";

export interface ServerHandle {
  url: string;
  close: () => Promise<void>;
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
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
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
  });
  await new Promise<void>((resolve) => {
    server.listen(opts.port, opts.host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : opts.port;
  return {
    url: `http://${opts.host}:${port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
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
  if ((req.headers.authorization ?? "") !== `Bearer ${operatorToken}`) {
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
  const mcp = createMcpServer(db);
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function main(): Promise<void> {
  loadDotenv();
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "8787");
  const { db, close: closeDb } = createDb(requireEnv("DATABASE_URL"));
  const handle = await startServer({
    host,
    port,
    db,
    operatorToken: requireEnv("KARDATA_OPERATOR_TOKEN"),
    onClose: closeDb,
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
