import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { ensureMigrated, getTestDb } from "../db.js";

let handle: DbHandle;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

afterAll(async () => {
  await handle.close();
});

async function query<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return (await handle.db.execute(q)) as unknown as T[];
}

describe("migrations on kardata_test", () => {
  it("creates exactly the stage-1 tables", async () => {
    const rows = await query<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    );
    const names = rows.map((r) => r.tablename).filter((n) => !n.startsWith("__drizzle"));
    expect(names.sort()).toEqual(["companies", "imports", "sector_companies", "sectors"]);
  });

  it("creates the signature columns", async () => {
    const rows = await query<{ table_name: string; column_name: string }>(
      sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    for (const want of [
      "sectors.name",
      "sectors.description",
      "companies.apollo_account_id",
      "companies.source",
      "companies.domain",
      "companies.shared_domain",
      "companies.technologies",
      "companies.keywords",
      "companies.raw",
      "companies.overrides",
      "companies.notes",
      "sector_companies.added_via",
      "sector_companies.first_import_id",
      "sector_companies.last_import_id",
      "sector_companies.removed_at",
      "imports.filename",
      "imports.file_sha256",
      "imports.rows_read",
      "imports.created_count",
      "imports.linked_count",
      "imports.updated_count",
      "imports.skipped_count",
      "imports.skipped",
    ]) {
      expect(have.has(want), `missing column ${want}`).toBe(true);
    }
  });

  it("creates the enums and the case-insensitive sector name index", async () => {
    const types = await query<{ typname: string }>(
      sql`SELECT typname FROM pg_type WHERE typname IN ('company_source', 'membership_added_via')`,
    );
    expect(types.map((t) => t.typname).sort()).toEqual(["company_source", "membership_added_via"]);
    const idx = await query<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sectors_name_lower_idx'`,
    );
    expect(idx).toHaveLength(1);
  });
});
