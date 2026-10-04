// Live Meta harness (sector backend v1, B1). Boots an isolated stack per
// suite: its own database, the kardata-live Temporal namespace (never the
// owner's default namespace), the real Meta provider (KARDATA_PROVIDER is
// deleted), the app with auth on port 3102, and in-process turn + research
// lane workers built by the SAME createDevWorkers factory as dev-worker.ts.
// Gated by KARDATA_LIVE_META=1 plus TEST_DATABASE_URL. Run files
// sequentially: see the live command in documentation/tests.md.
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { parseEnvFile } from '../../../deployment/scripts/stack-lib.mjs'
import { buildApp } from '../../../backend/src/app.js'
import { readExecutionRecord, resolveArchiveTarget } from '../../../backend/src/archive/targets.js'
import { hashKey } from '../../../backend/src/auth/keys.js'
import { connectWorker } from '../../../backend/src/temporal/connection.js'
import { createDevWorkers } from '../../../backend/src/temporal/dev-worker.js'
import { TemporalRunsGateway } from '../../../backend/src/temporal/gateway.js'
import { ensureTestDb } from '../db-helper.js'

export const LIVE_META_ENABLED =
  process.env['KARDATA_LIVE_META'] === '1' && typeof process.env['TEST_DATABASE_URL'] === 'string'

export const LIVE_PORT = 3102
export const LIVE_NAMESPACE = 'kardata-live'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'

const WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backend', 'src', 'temporal', 'workflows')

export interface LiveApiResult {
  status: number
  body: unknown
}

export interface LiveExecutionRequest {
  seq: number
  round: number
  record: Record<string, unknown>
}

export interface LiveStack {
  app: FastifyInstance
  pool: Pool
  ownerKey: string
  api(method: string, url: string, body?: unknown): Promise<LiveApiResult>
  waitFor(pred: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void>
  messages(threadKey: string): Promise<Array<Record<string, unknown>>>
  executionRequests(threadKey: string): Promise<LiveExecutionRequest[]>
  executionResponses(threadKey: string): Promise<LiveExecutionRequest[]>
  toolResults(threadKey: string): Promise<LiveExecutionRequest[]>
  spend(): Promise<{ inputTokens: number; outputTokens: number }>
  close(): Promise<void>
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// agents/.env values may contain shell-special characters that break
// `set -a; . agents/.env`; parse the file directly for keys that are
// absent, without ever printing them. Explicit env always wins.
function loadLiveKeys(): void {
  if (process.env['KARDATA_META_KEY']) return
  const envFile = join(REPO_ROOT, 'agents', '.env')
  if (!existsSync(envFile)) return
  const parsed = parseEnvFile(readFileSync(envFile, 'utf8'))
  for (const key of ['KARDATA_META_KEY', 'KARDATA_META_MODEL', 'KARDATA_META_MODE', 'KARDATA_WEB_SEARCH_KEY']) {
    if (parsed[key] && !process.env[key]) process.env[key] = parsed[key]
  }
}

export async function startLiveStack(suite: string): Promise<LiveStack> {
  loadLiveKeys()
  const url = await ensureTestDb(`kardata_live_${suite}`)
  const prevEnv = {
    TEMPORAL_NAMESPACE: process.env['TEMPORAL_NAMESPACE'],
    TEMPORAL_ADDRESS: process.env['TEMPORAL_ADDRESS'],
    DATABASE_URL: process.env['DATABASE_URL'],
    KARDATA_PROVIDER: process.env['KARDATA_PROVIDER'],
    KARDATA_MCP_URL: process.env['KARDATA_MCP_URL'],
    KARDATA_MCP_TOKEN: process.env['KARDATA_MCP_TOKEN'],
    KARDATA_ARCHIVE_DIR: process.env['KARDATA_ARCHIVE_DIR'],
  }
  process.env['TEMPORAL_NAMESPACE'] = LIVE_NAMESPACE
  process.env['TEMPORAL_ADDRESS'] = ADDRESS
  process.env['DATABASE_URL'] = url
  // Real Meta provider: the fake-provider override must be gone.
  delete process.env['KARDATA_PROVIDER']
  if (!process.env['KARDATA_ARCHIVE_DIR']) {
    process.env['KARDATA_ARCHIVE_DIR'] = join(tmpdir(), 'kardata-live-archive', suite)
  }

  const pool = new Pool({ connectionString: url })
  const ownerKey = randomBytes(24).toString('hex')
  const workerKey = randomBytes(24).toString('hex')
  await pool.query(
    `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles) VALUES ($1, $2, $3, $4, $5)`,
    ['live-owner', hashKey(ownerKey), 'tenant-live', null, 'approver'],
  )
  await pool.query(
    `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles) VALUES ($1, $2, $3, $4, $5)`,
    ['live-worker', hashKey(workerKey), 'tenant-live', null, 'approver'],
  )

  const app = buildApp({ pool, runs: new TemporalRunsGateway(pool), auth: true })
  await app.listen({ port: LIVE_PORT, host: '127.0.0.1' })
  process.env['KARDATA_MCP_URL'] = `http://127.0.0.1:${LIVE_PORT}/mcp`
  process.env['KARDATA_MCP_TOKEN'] = workerKey

  const connection: NativeConnection = await connectWorker()
  const { turnWorker, researchWorker } = await createDevWorkers(connection, {
    turnBundle: join(WORKFLOWS_DIR, 'turn-bundle.ts'),
    researchBundle: join(WORKFLOWS_DIR, 'research-bundle.ts'),
  })
  const workers: Worker[] = [turnWorker, researchWorker]
  const runs = workers.map((worker) => worker.run())
  for (const run of runs) run.catch(() => undefined)

  const base = `http://127.0.0.1:${LIVE_PORT}`
  const api = async (method: string, url: string, body?: unknown): Promise<LiveApiResult> => {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        authorization: `Bearer ${ownerKey}`,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const parsed: unknown = (() => {
      try {
        return text ? (JSON.parse(text) as unknown) : null
      } catch {
        return text
      }
    })()
    return { status: response.status, body: parsed }
  }

  const waitFor = async (pred: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (!(await pred())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
      await sleep(500)
    }
  }

  const messages = async (threadKey: string): Promise<Array<Record<string, unknown>>> => {
    const response = await api('GET', `/v1/threads/${encodeURIComponent(threadKey)}/messages`)
    if (response.status !== 200) throw new Error(`messages for ${threadKey} failed with ${response.status}`)
    const data = asRecord(response.body)['data']
    return Array.isArray(data) ? data.map(asRecord) : []
  }

  const executionRecords = async (threadKey: string, kind: string): Promise<LiveExecutionRequest[]> => {
    const out: LiveExecutionRequest[] = []
    let afterSeq = 0
    for (;;) {
      const list = await api('GET', `/v1/threads/${encodeURIComponent(threadKey)}/execution-records?afterSeq=${afterSeq}&limit=100`)
      if (list.status !== 200) throw new Error(`execution records for ${threadKey} failed with ${list.status}`)
      const data = asRecord(asRecord(list.body)['data'])
      const records = Array.isArray(data['records']) ? data['records'] : []
      for (const entry of records) {
        const row = asRecord(entry)
        if (row['kind'] !== kind) continue
        const seq = Number(row['seq'])
        const detail = await api('GET', `/v1/threads/${encodeURIComponent(threadKey)}/execution-records/${seq}`)
        if (detail.status !== 200) throw new Error(`execution record ${seq} failed with ${detail.status}`)
        out.push({ seq, round: Number(row['round'] ?? 0), record: asRecord(asRecord(asRecord(detail.body)['data'])['record']) })
      }
      const next = data['nextAfterSeq']
      if (typeof next !== 'number') break
      afterSeq = next
    }
    return out
  }

  // Suite-wide provider spend from the archived response records of this
  // suite's own database. Sums usage.inputTokens + usage.outputTokens.
  const spend = async (): Promise<{ inputTokens: number; outputTokens: number }> => {
    const archive = resolveArchiveTarget()
    const found = await pool.query<{ payload: unknown }>(`SELECT payload FROM events WHERE type='t.execution.recorded'`)
    let inputTokens = 0
    let outputTokens = 0
    for (const row of found.rows) {
      const payload = asRecord(row.payload)
      if (payload['kind'] !== 'response') continue
      const ref = asRecord(payload['ref'])
      if (typeof ref['key'] !== 'string' || typeof ref['hash'] !== 'string' || typeof ref['bytes'] !== 'number') continue
      const sessionId = payload['sessionId']
      if (typeof sessionId !== 'string') continue
      const abort = new AbortController()
      try {
        const record = await readExecutionRecord(
          archive,
          sessionId,
          { key: ref['key'], hash: ref['hash'], bytes: ref['bytes'] },
          abort.signal,
        )
        const usage = asRecord(asRecord(record)['data'])['usage']
        const u = asRecord(usage)
        if (typeof u['inputTokens'] === 'number') inputTokens += u['inputTokens']
        if (typeof u['outputTokens'] === 'number') outputTokens += u['outputTokens']
      } catch {
        continue
      } finally {
        abort.abort()
      }
    }
    return { inputTokens, outputTokens }
  }

  const close = async (): Promise<void> => {
    await app.close()
    await pool.end()
    for (const worker of workers) worker.shutdown()
    await Promise.all(runs.map((run) => run.catch(() => undefined)))
    await connection.close()
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  return { app, pool, ownerKey, api, waitFor, messages, executionRequests: (t) => executionRecords(t, 'request'), executionResponses: (t) => executionRecords(t, 'response'), toolResults: (t) => executionRecords(t, 'tool-result'), spend, close }
}
