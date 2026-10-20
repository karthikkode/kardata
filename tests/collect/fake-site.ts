import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export interface FakeHit {
  method: string;
  path: string;
  userAgent: string | undefined;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => void | Promise<void>;

export interface FakeSite {
  baseUrl: string;
  hits: FakeHit[];
  routes: Map<string, RouteHandler>;
  // Catches pathnames with no exact route (e.g. dynamic provider API paths).
  fallback?: RouteHandler;
  close: () => Promise<void>;
}

export function sendText(
  res: ServerResponse,
  text: string,
  status = 200,
  contentType = "text/html",
): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(text);
}

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  sendText(res, JSON.stringify(data), status, "application/json");
}

export async function startFakeSite(): Promise<FakeSite> {
  const hits: FakeHit[] = [];
  const routes = new Map<string, RouteHandler>();
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    hits.push({
      method: req.method ?? "",
      path: url.pathname,
      userAgent: req.headers["user-agent"],
    });
    const handler = routes.get(url.pathname) ?? site.fallback;
    if (!handler) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no such route");
      return;
    }
    void Promise.resolve()
      .then(() => handler(req, res, url))
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end("handler boom");
        }
      });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const site: FakeSite = {
    baseUrl: `http://127.0.0.1:${port}`,
    hits,
    routes,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
  return site;
}
