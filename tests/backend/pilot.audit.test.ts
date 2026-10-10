// Phase 8 B5: the audit fails on planted violations and passes a
// clean run. Fixtures live in an isolated database (one sector per
// case); the CLI exit mapping is covered by spawning it with
// PILOT_AUDIT_URL against a fake worktree.
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runPilotAudit } from '../../scripts/pilot-audit-lib.mjs'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const SINCE = '2026-01-01T00:00:00.000Z'

async function plantSector(pool: Pool, name: string, mutate?: (index: number) => Record<string, unknown>): Promise<string> {
  const sectorId = `sec-audit-${name}`
  await pool.query(
    `INSERT INTO sectors(id, name, topic, state, tenant_id) VALUES($1, $2, 'TEST audit', 'running', 'TEST audit')`,
    [sectorId, `TEST audit ${name}`],
  )
  for (let index = 0; index < 100; index++) {
    const id = `audit-${name}-c${index}`
    const child = `audit-${name}-t${index}`
    const override = mutate?.(index) ?? {}
    await pool.query(
      `INSERT INTO threads(key, session_id, kind, status) VALUES($1, $2, $3, 'done')
       ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, session_id = EXCLUDED.session_id`,
      [child, override.sessionId === null ? null : `sess-${index}`, override.threadKind ?? 'subagent'],
    )
    await pool.query(
      `INSERT INTO execution_rounds(run_id, thread_key, kind, round, attempt, model, provider, started_at, outcome, session_id)
       VALUES($1, $2, 'turn', 1, 1, 'TEST-model', 'TEST', now(), 'ok', $3)`,
      [`run-${id}`, child, override.roundSessionId === null ? null : `sess-${index}`],
    )
    await pool.query(
      `INSERT INTO research_work(id, sector_id, plan_version, kind, title, state, child_id, evidence, source_url, at)
       VALUES($1, $2, 1, 'company', $3, 'complete', $4, $5, $6, now())`,
      [
        id,
        sectorId,
        `TEST Co ${index}`,
        override.childId === null ? null : child,
        JSON.stringify(override.evidence ?? ['https://test.invalid/1', 'https://test.invalid/2', 'https://test.invalid/3']),
        override.sourceUrl === null ? null : `https://test.invalid/co-${index}`,
      ],
    )
  }
  return `TEST audit ${name}`
}

describe.skipIf(!TEST_DATABASE_URL)('pilot audit [F:pilot.audit]', () => {
  let pool: Pool
  let connectionString: string
  const sectors: Record<string, string> = {}

  beforeAll(async () => {
    connectionString = await ensureTestDb('kardata_test_pilot_audit')
    pool = new Pool({ connectionString })
    sectors.clean = await plantSector(pool, 'clean')
    sectors.short = await plantSector(pool, 'short', (index) => (index === 0 ? { childId: null } : {}))
    await pool.query(`DELETE FROM research_work WHERE id = 'audit-short-c0'`)
    sectors.nosource = await plantSector(pool, 'nosource', (index) => (index === 7 ? { sourceUrl: null } : {}))
    sectors.thin = await plantSector(pool, 'thin', (index) =>
      index === 9 ? { evidence: ['https://test.invalid/1'] } : {},
    )
    sectors.nochild = await plantSector(pool, 'nochild', (index) => (index === 11 ? { childId: null } : {}))
    sectors.nosession = await plantSector(pool, 'nosession', (index) => (index === 13 ? { roundSessionId: null } : {}))
  }, 180000)
  afterAll(async () => {
    await pool?.end()
  })

  async function audit(name: string) {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM sectors WHERE name = $1', [sectors[name]])
    return runPilotAudit(pool, { sectorId: rows[0]!.id, since: SINCE })
  }

  it('passes a clean run', async () => {
    expect(await audit('clean')).toEqual({ ok: true, violations: [] })
  })

  it('fails below 100 accepted', async () => {
    const result = await audit('short')
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/fewer than 100 accepted companies \(99/)
  })

  it('names the company missing a source URL', async () => {
    const result = await audit('nosource')
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('company audit-nosource-c7 has no fetched source URL')
  })

  it('names the company with thin evidence', async () => {
    const result = await audit('thin')
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('company audit-thin-c9 has 1 evidence items (need 3)')
  })

  it('names the company with no producing subagent', async () => {
    const result = await audit('nochild')
    expect(result.ok).toBe(false)
    expect(result.violations).toContain('company audit-nochild-c11 has no producing subagent (child_id null)')
  })

  it('names the company whose child lacks session attribution', async () => {
    const result = await audit('nosession')
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatch(/audit-nosession-c13.*session/)
  })

  it('CLI exits 0 clean / 1 naming the violation', async () => {
    const worktree = join(tmpdir(), `pilot-audit-cli-${Date.now()}`)
    mkdirSync(join(worktree, 'var', 'pilot', 'run-t1'), { recursive: true })
    writeFileSync(
      join(worktree, 'var', 'pilot', 'run-t1', 'state.json'),
      JSON.stringify({ tag: 't1', sectorName: sectors.clean }),
    )
    const cli = join(HERE, '..', '..', 'scripts', 'pilot-audit.mjs')
    const env = { ...process.env, PILOT_AUDIT_URL: connectionString }
    const clean = await run(process.execPath, [cli, '--worktree', worktree, '--tag', 't1', '--since', SINCE], { env })
    expect(clean.stdout).toContain('pilot:audit clean')
    writeFileSync(
      join(worktree, 'var', 'pilot', 'run-t1', 'state.json'),
      JSON.stringify({ tag: 't1', sectorName: sectors.nosource }),
    )
    const failed = await run(process.execPath, [cli, '--worktree', worktree, '--tag', 't1', '--since', SINCE], {
      env,
    }).then(
      () => ({ code: 0, stdout: '' }),
      (error: { code?: number; stdout?: string }) => ({ code: error.code ?? 1, stdout: String(error.stdout ?? '') }),
    )
    expect(failed.code).toBe(1)
    expect(failed.stdout).toContain('audit-nosource-c7 has no fetched source URL')
  }, 120000)
})
