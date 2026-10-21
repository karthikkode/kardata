import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type DbHandle } from "../src/db/client.js";
import { requireEnv } from "../src/lib/env.js";

export function getTestDb(): DbHandle {
  return createDb(requireEnv("TEST_DATABASE_URL"));
}

/** Wipe all stage-1 and research tables (test database only). */
export async function resetTestDb(handle: DbHandle): Promise<void> {
  await handle.db.execute(
    sql`TRUNCATE sectors, companies, sector_companies, imports, research_runs, run_events, blobs, sources, documents, findings, area_statuses, facts, records, shortlists, bulk_jobs, bulk_job_items, harness_settings, company_jobs, preflight_reports, provider_calls, job_events, http_fetches, web_searches CASCADE`,
  );
  // Registry seeds survive; provisional test registrations do not.
  await handle.db.execute(sql`DELETE FROM fact_keys WHERE status = 'provisional'`);
  await handle.db.execute(sql`DELETE FROM record_types WHERE status = 'provisional'`);
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
