import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

/** Transaction handle, derived so it always matches the installed driver. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A root handle or a transaction: everything both can query. */
export type DbLike = Db | DbTx;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(url: string): DbHandle {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema });
  return {
    db,
    close: async () => {
      await client.end();
    },
  };
}
