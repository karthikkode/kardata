// DB CLI. Usage: node dist/db/cli.js up|down|seed [tenantId] | kb-ingest [dir] | sweep [days]
// DATABASE_URL is required; MIGRATIONS_DIR overrides the default layout.
// `seed` writes a fixed demo graph (sectors, companies, states) under the
// tenant for compose acceptance. Fixed ids plus fixed idempotency keys make
// re-runs safe no-ops. `kb-ingest [dir]` records one versioned knowledge
// batch from curated markdown (KNOWLEDGE_DIR or <repo>/knowledge_base).
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runKbIngest } from './kb-ingest.js'
import {
  createSector,
  markCompanyFound,
  projectBatch,
  pruneHeartbeats,
  pruneOutbox,
  readEventsAfter,
  setCompanyStage,
  setSectorState,
  sweepIdempotency,
} from './index.js'
import { migrate, type Direction } from './migrate.js'
import { createDbPool } from './pool.js'

const command = process.argv[2]
if (command !== 'up' && command !== 'down' && command !== 'seed' && command !== 'kb-ingest' && command !== 'sweep') {
  console.error('usage: cli.js up|down|seed [tenantId] | kb-ingest [dir] | sweep [days]')
  process.exit(1)
}
const connectionString = process.env['DATABASE_URL']
if (!connectionString) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

if (command === 'seed') {
  const tenantId = process.argv[3] ?? 'demo'
  const scope = { tenantId, projectId: null }
  const pool = createDbPool(connectionString, {}, 'seed')
  // Writers read the projection, so catch up between write stages.
  const catchUp = async (): Promise<void> => {
    let from = 0
    for (;;) {
      const batch = await readEventsAfter(pool, from, 500)
      if (batch.length === 0) break
      await projectBatch(pool, batch)
      const last = batch[batch.length - 1]
      if (!last) break
      from = Number(last.seq)
    }
  }
  try {
    await createSector(pool, {
      name: 'Pet care',
      topic: 'D2C pet brands',
      scope,
      sectorId: 'seed-pet-care',
      idempotencyKey: 'seed:sector:pet-care',
    })
    await createSector(pool, {
      name: 'Espresso gear',
      topic: 'Home brewers',
      scope,
      sectorId: 'seed-espresso',
      idempotencyKey: 'seed:sector:espresso',
    })
    await createSector(pool, {
      name: 'Vintage hi-fi',
      topic: 'Used receivers',
      scope,
      sectorId: 'seed-hifi',
      idempotencyKey: 'seed:sector:hifi',
    })
    await catchUp()
    await markCompanyFound(pool, {
      sectorId: 'seed-pet-care',
      name: 'West Paw',
      stage: 'Final validation',
      state: 'running',
      scope,
      companyId: 'seed-west-paw',
      idempotencyKey: 'seed:company:west-paw',
    })
    await markCompanyFound(pool, {
      sectorId: 'seed-pet-care',
      name: 'Acme Audio',
      stage: 'Deep research',
      state: 'paused',
      scope,
      companyId: 'seed-acme',
      idempotencyKey: 'seed:company:acme',
    })
    await markCompanyFound(pool, {
      sectorId: 'seed-espresso',
      name: 'Foam House',
      stage: 'Final validation',
      state: 'complete',
      scope,
      companyId: 'seed-foam',
      idempotencyKey: 'seed:company:foam',
    })
    await catchUp()
    await setCompanyStage(pool, 'seed-acme', 'Deep research', {
      scope,
      idempotencyKey: 'seed:company-stage:acme',
    })
    await setSectorState(pool, 'seed-pet-care', 'running', {
      scope,
      idempotencyKey: 'seed:sector-state:pet-care',
    })
    await setSectorState(pool, 'seed-espresso', 'complete', {
      scope,
      idempotencyKey: 'seed:sector-state:espresso',
    })
    await setSectorState(pool, 'seed-hifi', 'failed', {
      scope,
      idempotencyKey: 'seed:sector-state:hifi',
    })
    // Project the state transitions so reads serve immediately.
    await catchUp()
    console.log(`seeded sector demo graph for tenant ${tenantId}`)
  } finally {
    await pool.end()
  }
  process.exit(0)
}

if (command === 'sweep') {
  // Retention sweep (B6): age out outbox frames, completed idempotency
  // replay records, and stale heartbeat rows older than the window.
  // Default 90 days; pass days explicitly for a shorter window.
  const days = Number(process.argv[3] ?? '90')
  if (!Number.isFinite(days) || days <= 0) {
    console.error('sweep days must be a positive number')
    process.exit(1)
  }
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const pool = createDbPool(connectionString, {}, 'sweep')
  try {
    const outbox = await pruneOutbox(pool, cutoff)
    const idempotency = await sweepIdempotency(pool, cutoff)
    const heartbeats = await pruneHeartbeats(pool, cutoff)
    console.log(`swept older than ${cutoff.toISOString()}: outbox=${outbox} idempotency=${idempotency} heartbeats=${heartbeats}`)
  } finally {
    await pool.end()
  }
  process.exit(0)
}

if (command === 'kb-ingest') {
  const kbDir =
    process.argv[3] ??
    process.env['KNOWLEDGE_DIR'] ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'knowledge_base')
  const batchId = `kb-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`
  const pool = createDbPool(connectionString, {}, 'kb-ingest')
  try {
    const result = await runKbIngest(pool, kbDir, batchId)
    console.log(`ingested kb batch ${result.batchId}: ${result.docs} docs`)
  } finally {
    await pool.end()
  }
  process.exit(0)
}

const dir =
  process.env['MIGRATIONS_DIR'] ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db', 'migrations')

const applied = await migrate(connectionString, dir, command as Direction)
for (const line of applied) console.log(line)
