// Deterministic TEST fleet generator for thousand-company scale runs.
// Same (seed, companyCount, docCount) always yields the same rows, so
// reruns are free and goldens stay stable. Every name and file carries
// its TEST label: generated rows can never pass as live data.
// Seeded PRNG (mulberry32): no dependencies, no network, no randomness
// outside the seed.
import type { Pool } from 'pg'
import type { CompanyStage } from '../../backend/src/db/sectors.js'

export interface FleetCompany {
  name: string
  stage: CompanyStage
}

export interface FleetDoc {
  filename: string
  text: string
}

const ADJECTIVES = [
  'Amber', 'Basalt', 'Cinder', 'Drift', 'Ember', 'Flint', 'Gale', 'Harbor',
  'Ion', 'Juniper', 'Kestrel', 'Lumen', 'Mesa', 'North', 'Opal', 'Pine',
  'Quartz', 'Ridge', 'Sable', 'Tundra', 'Umber', 'Vega', 'Willow', 'Yonder',
]

const NOUNS = [
  'Pay', 'Ledger', 'Mint', 'Vault', 'Rail', 'Settle', 'Credit', 'Capital',
  'Fund', 'Trade', 'Bond', 'Equity', 'Prime', 'Trust', 'Secure', 'Clear',
  'Swift', 'Bright', 'Novapay', 'Finch', 'Corelane', 'Bluefin', 'Redwood',
  'Starling', 'Parcel', 'Freight', 'Cargo', 'Harbor', 'Anchor', 'Beacon',
  'Signal', 'Relay', 'Vector', 'Pixel', 'Forge', 'Anvil', 'Compass', 'Atlas',
  'Summit', 'Harbor',
]

const STAGES: CompanyStage[] = ['Filter', 'Deep research', 'Problem found', 'Final validation']

const SECTORS = ['SME payments', 'cross-border payouts', 'real-time ledgers', 'escrow services']

const PARAGRAPH =
  'TEST DATA: this company is generated for thousand-company scale runs and is not a real business. ' +
  'It processes test transactions on a test ledger. Figures below are fixed per seed and carry no market meaning. '

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function generateFleet(seed: number, companyCount: number, docCount: number): { companies: FleetCompany[]; docs: FleetDoc[] } {
  if (!Number.isInteger(companyCount) || companyCount < 0) throw new Error('companyCount must be a non-negative integer')
  if (!Number.isInteger(docCount) || docCount < 0) throw new Error('docCount must be a non-negative integer')
  const rand = mulberry32(seed)
  const companies: FleetCompany[] = []
  for (let i = 0; i < companyCount; i++) {
    const adjective = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)] as string
    const noun = NOUNS[Math.floor(rand() * NOUNS.length)] as string
    const serial = String(i).padStart(4, '0')
    companies.push({ name: `TEST ${adjective} ${noun} ${serial}`, stage: STAGES[i % STAGES.length] as CompanyStage })
  }
  const docs: FleetDoc[] = []
  for (let i = 0; i < docCount; i++) {
    const company = companies[(i * 83) % Math.max(companies.length, 1)] ?? { name: 'TEST Placeholder 0000', stage: 'Filter' as CompanyStage }
    const sector = SECTORS[i % SECTORS.length]
    const big = i % 3 === 2
    const repeats = big ? 12 : 2
    const body = Array.from({ length: repeats }, () => PARAGRAPH).join('') +
      `Covers ${company.name} in ${sector}. Founded in test year ${2000 + (i % 24)}. ` +
      `Headquarters: Test City ${i}. Flagship: test product ${i}.`
    docs.push({ filename: `test-fleet-${String(i).padStart(3, '0')}.md`, text: `# ${company.name}\n\n${body}\n` })
  }
  return { companies, docs }
}

// P3.6 stress volume: production-shaped row counts for the hot-query and
// writer-contention tiers. Deterministic on the seed; every id carries its
// TEST label. Bulk multi-row INSERTs keep the seed itself in minutes.
export interface StressVolume {
  events: number
  messages: number
  rounds: number
  companies: number
  documents: number
}

// Phase 7 reduced scale for the CI integration job:
// KARDATA_STRESS_SCALE=reduced seeds 1/10th (100k events, 20 sessions,
// 200 threads). Full scale stays the default (local release gate).
const REDUCED_SCALE = process.env['KARDATA_STRESS_SCALE'] === 'reduced'

export const STRESS_VOLUME: StressVolume = REDUCED_SCALE
  ? { events: 100_000, messages: 20_000, rounds: 10_000, companies: 2_000, documents: 500 }
  : { events: 1_000_000, messages: 200_000, rounds: 100_000, companies: 20_000, documents: 5_000 }

export interface StressSeed {
  sectorId: string
  sessionId: string
  threadKey: string
  eventKey: string
}

const STRESS_SEED = 20261005
const STRESS_SESSIONS = REDUCED_SCALE ? 20 : 200
const STRESS_THREADS = REDUCED_SCALE ? 200 : 2000

async function batchInsert(pool: Pool, table: string, columns: string, count: number, makeRow: (index: number) => unknown[], batchSize: number): Promise<void> {
  const width = columns.split(',').length
  for (let start = 0; start < count; start += batchSize) {
    const size = Math.min(batchSize, count - start)
    const params: unknown[] = []
    const tuples: string[] = []
    for (let offset = 0; offset < size; offset++) {
      const row = makeRow(start + offset)
      const base = offset * width
      params.push(...row)
      tuples.push(`(${row.map((_, column) => `$${base + column + 1}`).join(',')})`)
    }
    await pool.query(`INSERT INTO ${table}(${columns}) VALUES ${tuples.join(',')}`, params)
  }
}

function stressId(kind: string, index: number): string {
  return `TEST stress ${kind} ${String(index).padStart(7, '0')}`
}

/** Seeds the P3.6 volume into an isolated test database: one sector, 200
 * event-sourced sessions, 2000 threads, and the configured row counts.
 * Returns the handles the hot-query tier reads through. */
export async function seedStressVolume(pool: Pool, volume: Partial<StressVolume> = {}): Promise<StressSeed> {
  const target: StressVolume = { ...STRESS_VOLUME, ...volume }
  const rand = mulberry32(STRESS_SEED)
  const sectorId = 'TEST stress sector'
  const sessionId = stressId('session', 0)
  const threadKey = stressId('thread', 0)
  await pool.query(
    `INSERT INTO sectors(id, name, topic, state, tenant_id) VALUES ($1, 'TEST stress sector', 'stress', 'running', 'TEST stress tenant')
     ON CONFLICT(id) DO NOTHING`,
    [sectorId],
  )
  await pool.query(
    `INSERT INTO sector_workspace(sector_id, research_session_id, sections) VALUES ($1, $2, '{}')
     ON CONFLICT(sector_id) DO NOTHING`,
    [sectorId, sessionId],
  )
  await batchInsert(pool, 'threads', 'key,session_id,kind,status', STRESS_THREADS, (index) => [
    stressId('thread', index), stressId('session', index % STRESS_SESSIONS), index % 5 === 4 ? 'subagent' : 'session', 'idle',
  ], 2000)

  const perThread = Math.floor(target.messages / STRESS_THREADS)
  await batchInsert(pool, 'thread_messages', 'thread_key,seq,kind,payload', perThread * STRESS_THREADS, (index) => {
    const thread = Math.floor(index / perThread)
    const seq = (index % perThread) + 1
    return [stressId('thread', thread), seq, 'text', JSON.stringify({ role: seq % 2 === 0 ? 'agent' : 'user', text: `TEST stress message ${thread}:${seq}` })]
  }, 2000)

  const eventTypes = ['t.message.appended', 't.provider.round', 't.tool.call', 't.thread.state', 't.execution.recorded', 't.artifact.stored']
  await batchInsert(pool, 'events', 'idempotency_key,partition,type,payload,redacted,at,trace_id,client', target.events, (index) => {
    if (index < STRESS_SESSIONS) {
      const id = stressId('session', index)
      return [
        `TEST stress key session ${index}`, `session:${id}`, 't.session.created',
        JSON.stringify({ sessionId: id, title: `TEST stress chat ${index}`, sectorId, tenantId: 'TEST stress tenant' }),
        false, new Date(Date.now() - Math.floor(rand() * 30 * 86400_000)).toISOString(), null, null,
      ]
    }
    const pick = Math.floor(rand() * STRESS_SESSIONS)
    const type = eventTypes[Math.floor(rand() * eventTypes.length)] as string
    const partition = type === 't.artifact.stored' ? `artifact:session:${stressId('session', pick)}` : `session:${stressId('session', pick)}`
    return [
      `TEST stress key ${index}`, partition, type,
      JSON.stringify({ threadKey: stressId('thread', pick * 10), seq: index, note: 'TEST stress filler' }),
      false, new Date(Date.now() - Math.floor(rand() * 30 * 86400_000)).toISOString(),
      rand() < 0.1 ? `TEST stress trace ${index % 1000}` : null,
      rand() < 0.5 ? 'ui' : 'agent-mcp',
    ]
  }, 1000)

  const roundKinds = ['chat', 'research', 'subagent', 'compaction', 'file-summary', 'plan']
  const roundOutcomes = ['ok', 'ok', 'ok', 'ok', 'error', 'timeout', 'cancelled']
  const roundsPerThread = Math.floor(target.rounds / STRESS_THREADS)
  await batchInsert(
    pool, 'execution_rounds',
    'run_id,thread_key,session_id,sector_id,kind,round,attempt,model,provider,started_at,finished_at,input_tokens,output_tokens,cached_tokens,outcome',
    roundsPerThread * STRESS_THREADS,
    (index) => {
      const thread = Math.floor(index / roundsPerThread)
      return [
        `TEST stress run ${thread}`, stressId('thread', thread), stressId('session', thread % STRESS_SESSIONS), sectorId,
        roundKinds[Math.floor(rand() * roundKinds.length)], (index % roundsPerThread) + 1, 0, 'meta-test', 'meta',
        new Date().toISOString(), new Date().toISOString(),
        100 + Math.floor(rand() * 900), 50 + Math.floor(rand() * 450), 0,
        roundOutcomes[Math.floor(rand() * roundOutcomes.length)],
      ]
    },
    1000,
  )

  const states = ['running', 'queued', 'complete', 'failed', 'paused']
  await batchInsert(pool, 'companies', 'id,sector_id,name,stage,state,tenant_id,project_id', target.companies, (index) => [
    stressId('company', index), sectorId, `TEST Stress Co ${index % 19000}`,
    STAGES[index % STAGES.length], states[index % states.length], 'TEST stress tenant', null,
  ], 2000)

  await batchInsert(pool, 'sector_documents', 'id,sector_id,filename,media_type,text,sha256,tenant_id,project_id', target.documents, (index) => {
    const text = `# TEST stress file ${index}\n\n${PARAGRAPH.repeat(3)}Covers TEST Stress Co ${index % 19000}.\n`
    return [stressId('document', index), sectorId, `test-stress-${index}.md`, 'text/markdown', text, `TEST stress sha ${index}`, 'TEST stress tenant', null]
  }, 1000)
  await batchInsert(pool, 'sector_document_units', 'document_id,ord,kind,text,confidence,uncertain,sha256', target.documents, (index) => {
    const text = `# TEST stress file ${index}\n\n${PARAGRAPH.repeat(3)}Covers TEST Stress Co ${index % 19000}.\n`
    return [stressId('document', index), 0, 'paragraph', text, null, false, `TEST stress unit sha ${index}`]
  }, 1000)

  await batchInsert(pool, 'research_work', 'id,sector_id,plan_version,kind,title,state,attempts,child_id,evidence,detail', 2000, (index) => [
    stressId('work', index), sectorId, 1, 'company', `TEST Stress Co ${index % 19000}`,
    index % 2 === 0 ? 'complete' : 'failed', 1, null,
    index % 2 === 0 ? '["https://example.com/TEST-stress"]' : '[]', '',
  ], 1000)

  await batchInsert(pool, 'outbox', 'thread_key,type,payload,at', 1000, (index) => [
    threadKey, 't.message.appended', JSON.stringify({ seq: index }), new Date().toISOString(),
  ], 1000)

  await batchInsert(pool, 'alerts', 'kind,severity,subject,thread_key,sector_id', 50, (index) => [
    'no-progress', index % 2 === 0 ? 'high' : 'medium', `TEST stress alert ${index}`, threadKey, sectorId,
  ], 50)

  await pool.query('ANALYZE')
  return { sectorId, sessionId, threadKey, eventKey: 'TEST stress key 500000' }
}
