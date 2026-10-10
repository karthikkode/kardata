// Phase 8 B5 UI-only audit (P8-B1): (a) events by client, (b)
// violation alerts, (c) owner-type client rules. Each lib case runs in
// its own rolled-back transaction (the audit is DB-wide, so committed
// fixtures would leak across cases); the CLI case owns a second
// database. No state.json anywhere: the audit needs no sector.
import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runPilotAudit } from '../../scripts/pilot-audit-lib.mjs'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const SINCE = '2026-01-01T00:00:00.000Z'
const BEFORE = '2025-06-01T00:00:00.000Z'
let nonce = 0

async function plantEvent(
  db: PoolClient,
  type: string,
  client: string | null,
  extra: { at?: string; payload?: Record<string, unknown> } = {},
) {
  await db.query(
    'INSERT INTO events(idempotency_key, partition, type, payload, client, at) VALUES($1, $2, $3, $4, $5, $6)',
    [`TEST audit ${++nonce}`, 'TEST', type, JSON.stringify(extra.payload ?? {}), client, extra.at ?? '2026-03-01T00:00:00.000Z'],
  )
}

async function plantAlert(db: PoolClient, at: string) {
  await db.query("INSERT INTO alerts(kind, severity, subject, created_at) VALUES('ui_only_violation', 'high', 'TEST', $1)", [
    at,
  ])
}

describe.skipIf(!TEST_DATABASE_URL)('pilot UI-only audit [F:pilot.audit]', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_pilot_audit') })
  }, 120000)
  afterAll(async () => {
    await pool?.end()
  })

  async function auditCase(plant: (db: PoolClient) => Promise<void>) {
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      await plant(db)
      const result = await runPilotAudit(db, { since: SINCE })
      await db.query('ROLLBACK')
      return result as { ok: boolean; counts: { eventsByClient: Record<string, number>; violationAlerts: number }; violations: string[] }
    } finally {
      db.release()
    }
  }

  it('passes a clean run (ui + system + agent-mcp traffic, old junk ignored)', async () => {
    const result = await auditCase(async (db) => {
      await plantEvent(db, 'sector.created', 'ui')
      await plantEvent(db, 'sector.plan_approved', 'ui')
      await plantEvent(db, 'sector.context.decided', 'ui')
      await plantEvent(db, 'sector.file.processing.created', 'ui')
      await plantEvent(db, 'sector.plan_written', 'system')
      await plantEvent(db, 'sector.state_changed', 'system')
      await plantEvent(db, 't.thread.state', 'ui', { payload: { status: 'CANCELLING' } })
      await plantEvent(db, 't.message.appended', 'agent-mcp')
      await plantEvent(db, 't.thread.state', 'system', { payload: { status: 'RUNNING' } })
      // Outside the window: must not trip anything.
      await plantEvent(db, 't.message.appended', 'other', { at: BEFORE })
      await plantAlert(db, BEFORE)
    })
    expect(result).toMatchObject({ ok: true, violations: [] })
    expect(result.counts.eventsByClient).toMatchObject({ ui: 5, system: 3, 'agent-mcp': 1 })
    expect(result.counts.violationAlerts).toBe(0)
  })

  it("fails on 'other' and unstamped events", async () => {
    const other = await auditCase(async (db) => {
      await plantEvent(db, 't.message.appended', 'other')
    })
    expect(other.ok).toBe(false)
    expect(other.violations[0]).toMatch(/1 events with client 'other' or unstamped/)
    const unstamped = await auditCase(async (db) => {
      await plantEvent(db, 't.message.appended', null)
    })
    expect(unstamped.ok).toBe(false)
    expect(unstamped.violations[0]).toMatch(/1 events with client 'other' or unstamped/)
  })

  it('fails on a violation alert in the window', async () => {
    const result = await auditCase(async (db) => {
      await plantAlert(db, '2026-04-01T00:00:00.000Z')
    })
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('1 ui_only_violation alerts since 2026-01-01T00:00:00.000Z')
  })

  it('fails an owner-type event with a non-UI client', async () => {
    const result = await auditCase(async (db) => {
      await plantEvent(db, 'sector.created', 'agent-mcp')
    })
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatch(/owner-type event sector\.created #\d+ has client 'agent-mcp'/)
  })

  it('fails dual-producer types on agent-mcp/other but admits ui and system', async () => {
    const bad = await auditCase(async (db) => {
      await plantEvent(db, 'sector.plan_written', 'agent-mcp')
      await plantEvent(db, 'sector.state_changed', 'other')
    })
    expect(bad.ok).toBe(false)
    expect(bad.violations.filter((v) => v.includes('sector.plan_written'))).toHaveLength(1)
    expect(bad.violations.filter((v) => v.includes('sector.state_changed'))).toHaveLength(1)
    const good = await auditCase(async (db) => {
      await plantEvent(db, 'sector.plan_written', 'ui')
      await plantEvent(db, 'sector.state_changed', 'system')
    })
    expect(good).toMatchObject({ ok: true, violations: [] })
  })

  it('fails a non-UI CANCELLING but ignores other thread states', async () => {
    const bad = await auditCase(async (db) => {
      await plantEvent(db, 't.thread.state', 'agent-mcp', { payload: { status: 'CANCELLING' } })
    })
    expect(bad.ok).toBe(false)
    expect(bad.violations[0]).toMatch(/owner-type event t\.thread\.state #\d+ has client 'agent-mcp'/)
  })

  it('CLI exits 0 clean / 1 naming the violation, with no state.json', async () => {
    const connectionString = await ensureTestDb('kardata_test_pilot_audit_cli')
    const cliPool = new Pool({ connectionString })
    try {
      const db = await cliPool.connect()
      try {
        await plantEvent(db, 'sector.created', 'ui')
      } finally {
        db.release()
      }
      const worktree = mkdtempSync(join(tmpdir(), 'pilot-audit-cli-'))
      const cli = join(HERE, '..', '..', 'scripts', 'pilot-audit.mjs')
      const env = { ...process.env, PILOT_AUDIT_URL: connectionString }
      const args = ['--worktree', worktree, '--tag', 't1', '--since', SINCE]
      const clean = await run(process.execPath, [cli, ...args], { env })
      expect(clean.stdout).toContain('client ui: 1')
      expect(clean.stdout).toContain('pilot:audit clean')
      const db2 = await cliPool.connect()
      try {
        await plantAlert(db2, '2026-04-01T00:00:00.000Z')
      } finally {
        db2.release()
      }
      const failed = await run(process.execPath, [cli, ...args], { env }).then(
        () => ({ code: 0, stdout: '' }),
        (error: { code?: number; stdout?: string }) => ({ code: error.code ?? 1, stdout: String(error.stdout ?? '') }),
      )
      expect(failed.code).toBe(1)
      expect(failed.stdout).toContain('1 ui_only_violation alerts')
    } finally {
      await cliPool.end()
    }
  }, 120000)
})
