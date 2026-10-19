import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "./db/client.js";
import { loadDotenv, requireEnv } from "./lib/env.js";

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

export async function startServer(opts: {
  host: string;
  port: number;
  db: Db;
  onClose?: () => Promise<void>;
}): Promise<ServerHandle> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "GET" && path === "/healthz") {
        await handleHealthz(opts.db, res);
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

async function main(): Promise<void> {
  loadDotenv();
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "8787");
  const { db, close: closeDb } = createDb(requireEnv("DATABASE_URL"));
  const handle = await startServer({ host, port, db, onClose: closeDb });
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
