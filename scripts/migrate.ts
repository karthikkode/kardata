import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db/client.js";
import { loadDotenv, requireEnv } from "../src/lib/env.js";

async function migrateOne(name: string, url: string, folder: string): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: folder });
    console.log(`migrated ${name}`);
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
  await migrateOne("dev", requireEnv("DATABASE_URL"), folder);
  await migrateOne("test", requireEnv("TEST_DATABASE_URL"), folder);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
