import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type Db = PostgresJsDatabase;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(url: string): DbHandle {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client);
  return {
    db,
    close: async () => {
      await client.end();
    },
  };
}
