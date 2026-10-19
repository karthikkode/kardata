import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type DbHandle } from "../src/db/client.js";
import { requireEnv } from "../src/lib/env.js";

export function getTestDb(): DbHandle {
  return createDb(requireEnv("TEST_DATABASE_URL"));
}

/** Wipe all stage-1 tables (test database only). */
export async function resetTestDb(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`TRUNCATE sectors, companies, sector_companies, imports CASCADE`);
}

export function fixtureCsvPath(): string {
  return join(process.cwd(), "tests/fixtures/apollo-sample.csv");
}

export function badHeadersCsvPath(): string {
  return join(process.cwd(), "tests/fixtures/apollo-bad-headers.csv");
}

export function fixtureImportDirs(): string[] {
  return [join(process.cwd(), "tests/fixtures")];
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
