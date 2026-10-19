import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type DbHandle } from "../src/db/client.js";
import { requireEnv } from "../src/lib/env.js";

export function getTestDb(): DbHandle {
  return createDb(requireEnv("TEST_DATABASE_URL"));
}

/** Idempotent migrate with retries so parallel test workers stay safe on a fresh DB. */
export async function ensureMigrated(handle: DbHandle): Promise<void> {
  const folder = join(process.cwd(), "src/db/migrations");
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await migrate(handle.db, { migrationsFolder: folder });
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}
