import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "../src/db/client.js";
import { backfillApolloImportSources } from "../src/domain/research/sources.js";
import { loadDotenv, requireEnv } from "../src/lib/env.js";

/** Create the database if missing (42P04 = duplicate_database). */
async function ensureDatabase(url: string): Promise<void> {
  const match = /^(.*\/)([^/?]+)(\?.*)?$/.exec(url);
  if (!match?.[1] || !match[2]) throw new Error("cannot parse database URL");
  const admin = postgres(`${match[1]}postgres`, { max: 1 });
  try {
    const name = match[2].replace(/"/g, '""');
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  } finally {
    await admin.end();
  }
}

async function migrateOne(name: string, url: string, folder: string): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: folder });
    console.log(`migrated ${name}`);
    const backfill = await backfillApolloImportSources(db);
    console.log(
      `backfilled ${name}: ${backfill.created} sources created, ${backfill.alreadyHad} already had one, ${backfill.skippedNoImport} skipped (no import)`,
    );
  } finally {
    await close();
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const folder = join(process.cwd(), "src/db/migrations");
  const hasMigrations =
    existsSync(join(folder, "meta/_journal.json")) ||
    (existsSync(folder) && readdirSync(folder).some((f) => f.endsWith(".sql")));
  if (!hasMigrations) {
    console.log("no migrations yet; nothing to do");
    return;
  }
  const devUrl = requireEnv("DATABASE_URL");
  const testUrl = requireEnv("TEST_DATABASE_URL");
  await ensureDatabase(devUrl);
  await ensureDatabase(testUrl);
  await migrateOne("dev", devUrl, folder);
  await migrateOne("test", testUrl, folder);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
