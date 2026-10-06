import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import { migrate, migrationFiles } from '../../backend/src/db/migrate.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')
const DB = TEST_DATABASE_URL

async function tables(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )
  return rows.map((row) => row.tablename)
}

describe('migrations (B0.3)', () => {
  it('lists migration files in version order', () => {
    expect(migrationFiles(DIR)).toEqual(['0001_init.sql', '0002_ledger_event_seq.sql', '0003_projection_checkpoints.sql', '0004_outbox_notify.sql', '0005_api_keys.sql', '0006_rate_idempotency.sql', '0007_sector_domain.sql', '0008_knowledge_ledger.sql', '0009_sector_drafts.sql', '0010_sector_document_units.sql', '0011_sector_context_selection.sql', '0012_sector_research_session.sql', '0013_sector_planning_states.sql', '0014_sector_workspace.sql', '0015_workspace_file_index.sql', '0016_turn_continuations.sql', '0017_workspace_measurements.sql', '0018_workspace_hardening.sql', '0019_turn_attempt_leases.sql', '0020_context_file_dependencies.sql', '0021_execution_epochs.sql', '0022_intake_review.sql', '0023_file_processing.sql', '0024_sector_model_v1.sql', '0025_phase2.sql', '0026_phase4.sql', '0027_monitors.sql', '0028_thread_state_reason.sql', '0029_thread_turn_started_at.sql', '0030_reliability_stalls.sql'])
  })

  it('every migration file carries up and down markers [F:db.migrate.migrate] [F:db.migrate.migrationFiles]', () => {
    const missing = migrationFiles(DIR).filter((file) => {
      const lines = readFileSync(join(DIR, file), 'utf8').split('\n').map((line) => line.trim())
      return !lines.includes('-- migrate:up') || !lines.includes('-- migrate:down')
    })
    expect(missing).toEqual([])
  })

  describe.skipIf(!DB)('against Postgres [F:db.migrate.migrate] [F:db.migrate.migrationFiles]', () => {
    it('serializes simultaneous migrators on one isolated database', async () => {
      const connectionString = await ensureTestDb('kardata_test_migration_race')
      await migrate(connectionString, DIR, 'down')
      const results = await Promise.all(Array.from({ length: 3 }, () => migrate(connectionString, DIR, 'up')))
      const applied = results.flat()
      expect(applied).toHaveLength(migrationFiles(DIR).length)
      expect(new Set(applied).size).toBe(applied.length)
      expect(await migrate(connectionString, DIR, 'up')).toEqual([])
    })
    it('up creates the schema, duplicate idempotency rejects, up is idempotent', async () => {
      const connectionString = await ensureTestDb('kardata_test_migrations_up')
      await migrate(connectionString, DIR, 'down')
      const applied = await migrate(connectionString, DIR, 'up')
      expect(applied).toEqual(['up:0001_init', 'up:0002_ledger_event_seq', 'up:0003_projection_checkpoints', 'up:0004_outbox_notify', 'up:0005_api_keys', 'up:0006_rate_idempotency', 'up:0007_sector_domain', 'up:0008_knowledge_ledger', 'up:0009_sector_drafts', 'up:0010_sector_document_units', 'up:0011_sector_context_selection', 'up:0012_sector_research_session', 'up:0013_sector_planning_states', 'up:0014_sector_workspace', 'up:0015_workspace_file_index', 'up:0016_turn_continuations', 'up:0017_workspace_measurements', 'up:0018_workspace_hardening', 'up:0019_turn_attempt_leases', 'up:0020_context_file_dependencies', 'up:0021_execution_epochs', 'up:0022_intake_review', 'up:0023_file_processing', 'up:0024_sector_model_v1', 'up:0025_phase2', 'up:0026_phase4', 'up:0027_monitors', 'up:0028_thread_state_reason', 'up:0029_thread_turn_started_at', 'up:0030_reliability_stalls'])
      // Second up is a no-op.
      expect(await migrate(connectionString, DIR, 'up')).toEqual([])

      const client = new Client({ connectionString })
      await client.connect()
      try {
        expect(await tables(client)).toEqual(
          expect.arrayContaining(['events', 'heartbeats', 'outbox', 'threads', 'thread_messages', 'ledger_entries', 'projection_checkpoints', 'api_keys', 'rate_windows', 'idempotency_records', 'schema_migrations', 'sectors', 'companies', 'kb_documents', 'kb_chunks', 'ledger_companies', 'ledger_problems', 'sector_documents', 'sector_document_units', 'sector_context_selection', 'sector_context_notes', 'sector_workspace', 'workspace_changes', 'thread_context', 'workspace_files', 'research_work', 'thread_instructions', 'file_processing_jobs', 'file_processing_images', 'file_processing_attempts', 'session_settings', 'context_file_blocks']),
        )
        await client.query(
          "INSERT INTO events (idempotency_key, partition, type) VALUES ('k1', 'p1', 't.run.started')",
        )
        await expect(
          client.query("INSERT INTO events (idempotency_key, partition, type) VALUES ('k1', 'p1', 't.run.started')"),
        ).rejects.toThrow(/duplicate key|unique/i)
      } finally {
        await client.end()
      }
    })

    it('down then up round-trips on an empty database', async () => {
      const connectionString = await ensureTestDb('kardata_test_migrations_roundtrip')
      // ensureTestDb already supplies a validated, migrated empty schema.
      expect(await migrate(connectionString, DIR, 'down')).toEqual([
        'down:0030_reliability_stalls',
        'down:0029_thread_turn_started_at',
        'down:0028_thread_state_reason',
        'down:0027_monitors',
        'down:0026_phase4',
        'down:0025_phase2',
        'down:0024_sector_model_v1',
        'down:0023_file_processing',
        'down:0022_intake_review',
        'down:0021_execution_epochs',
        'down:0020_context_file_dependencies',
        'down:0019_turn_attempt_leases',
        'down:0018_workspace_hardening',
        'down:0017_workspace_measurements',
        'down:0016_turn_continuations',
        'down:0015_workspace_file_index',
        'down:0014_sector_workspace',
        'down:0013_sector_planning_states',
        'down:0012_sector_research_session',
        'down:0011_sector_context_selection',
        'down:0010_sector_document_units',
        'down:0009_sector_drafts',
        'down:0008_knowledge_ledger',
        'down:0007_sector_domain',
        'down:0006_rate_idempotency',
        'down:0005_api_keys',
        'down:0004_outbox_notify',
        'down:0003_projection_checkpoints',
        'down:0002_ledger_event_seq',
        'down:0001_init',
      ])
      const client = new Client({ connectionString })
      await client.connect()
      try {
        expect(await tables(client)).toEqual([])
      } finally {
        await client.end()
      }
      expect(await migrate(connectionString, DIR, 'up')).toEqual(['up:0001_init', 'up:0002_ledger_event_seq', 'up:0003_projection_checkpoints', 'up:0004_outbox_notify', 'up:0005_api_keys', 'up:0006_rate_idempotency', 'up:0007_sector_domain', 'up:0008_knowledge_ledger', 'up:0009_sector_drafts', 'up:0010_sector_document_units', 'up:0011_sector_context_selection', 'up:0012_sector_research_session', 'up:0013_sector_planning_states', 'up:0014_sector_workspace', 'up:0015_workspace_file_index', 'up:0016_turn_continuations', 'up:0017_workspace_measurements', 'up:0018_workspace_hardening', 'up:0019_turn_attempt_leases', 'up:0020_context_file_dependencies', 'up:0021_execution_epochs', 'up:0022_intake_review', 'up:0023_file_processing', 'up:0024_sector_model_v1', 'up:0025_phase2', 'up:0026_phase4', 'up:0027_monitors', 'up:0028_thread_state_reason', 'up:0029_thread_turn_started_at', 'up:0030_reliability_stalls'])
    })
  })

  if (!DB) {
    it('notes the live-DB gate', () => {
      expect(DB).toBeUndefined()
    })
  }
})
