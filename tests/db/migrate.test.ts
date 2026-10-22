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
  it("creates exactly the stage-1, research and company-pipeline tables", async () => {
    const rows = await query<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    );
    const names = rows.map((r) => r.tablename).filter((n) => !n.startsWith("__drizzle"));
    expect(names.sort()).toEqual([
      "area_statuses",
      "blobs",
      "bulk_job_items",
      "bulk_jobs",
      "companies",
      "company_jobs",
      "documents",
      "fact_keys",
      "facts",
      "findings",
      "harness_settings",
      "http_fetches",
      "imports",
      "job_events",
      "preflight_reports",
      "provider_calls",
      "record_types",
      "records",
      "research_runs",
      "run_events",
      "run_tokens",
      "sector_companies",
      "sector_eligibility_overrides",
      "sector_preflight",
      "sector_preflight_items",
      "sector_preflight_jobs",
      "sectors",
      "shortlists",
      "sources",
      "web_searches",
    ]);
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
      "research_runs.company_id",
      "research_runs.kind",
      "research_runs.status",
      "research_runs.requested_areas",
      "research_runs.batch_id",
      "research_runs.prompt_version",
      "research_runs.request_count",
      "run_events.run_id",
      "run_events.type",
      "run_events.payload",
      "blobs.sha256",
      "blobs.gzip",
      "sources.url",
      "sources.final_url",
      "sources.collector",
      "sources.status",
      "sources.blob_sha256",
      "documents.area",
      "documents.kind",
      "documents.content_md",
      "documents.source_ids",
      "documents.created_by",
      "documents.tsv",
      "findings.claim",
      "findings.source_ids",
      "findings.confidence",
      "area_statuses.status",
      "area_statuses.reason",
    ]) {
      expect(have.has(want), `missing column ${want}`).toBe(true);
    }
  });

  it("creates the enums and the case-insensitive sector name index", async () => {
    const types = await query<{ typname: string }>(
      sql`SELECT typname FROM pg_type WHERE typname IN ('company_source', 'membership_added_via', 'area', 'run_kind', 'run_status', 'source_status', 'document_kind', 'confidence', 'finding_status', 'area_status')`,
    );
    expect(types.map((t) => t.typname).sort()).toEqual([
      "area",
      "area_status",
      "company_source",
      "confidence",
      "document_kind",
      "finding_status",
      "membership_added_via",
      "run_kind",
      "run_status",
      "source_status",
    ]);
    const idx = await query<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'sectors_name_lower_idx'`,
    );
    expect(idx).toHaveLength(1);
  });

  it("creates the one-active-run index and the research checks", async () => {
    const idx = await query<{ indexname: string; indexdef: string }>(
      sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'research_runs_one_active_idx'`,
    );
    expect(idx).toHaveLength(1);
    expect(idx[0]?.indexdef).toContain("WHERE");
    // Scoped to the creation-time kinds only (later-added enum values are
    // unusable in the same transaction on a fresh database).
    expect(idx[0]?.indexdef).toContain("agent");
    expect(idx[0]?.indexdef).toContain("collect");
    expect(idx[0]?.indexdef).not.toContain("sector_preflight");
    const checks = await query<{ conname: string }>(
      sql`SELECT conname FROM pg_constraint WHERE conname IN ('findings_source_ids_not_empty', 'area_statuses_reason_required')`,
    );
    expect(checks.map((c) => c.conname).sort()).toEqual([
      "area_statuses_reason_required",
      "findings_source_ids_not_empty",
    ]);
    const gin = await query<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'documents_tsv_idx'`,
    );
    expect(gin).toHaveLength(1);
  });
});
