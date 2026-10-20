import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../src/db/client.js";
import { parseHosts, startServer, type ServerHandle } from "../src/server.js";
import { ensureMigrated, getTestDb } from "./db.js";

let handle: DbHandle;
const servers: ServerHandle[] = [];

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

afterAll(async () => {
  for (const server of servers.splice(0)) await server.close();
  await handle.close();
});

describe("server listen", () => {
  it("parses a comma host list", () => {
    expect(parseHosts("127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(parseHosts("127.0.0.1, 172.31.250.1")).toEqual(["127.0.0.1", "172.31.250.1"]);
    expect(() => parseHosts(" , ")).toThrow(/at least one/);
  });

  it("serves every listed address", async () => {
    const server = await startServer({
      host: "127.0.0.1,127.0.0.2",
      port: 0,
      db: handle.db,
      operatorToken: "test",
    });
    servers.push(server);
    expect(server.hosts).toEqual(["127.0.0.1", "127.0.0.2"]);
    expect(server.urls).toHaveLength(2);
    for (const url of server.urls) {
      const res = await fetch(`${url}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, db: true });
    }
  });
});
