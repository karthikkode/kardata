// Process entry: build the app and listen. Kept separate from app.ts so
// tests import the app without binding a port. B0.1. B3.1 wires the pool
// (lazy: construction never connects) and the Temporal runs gateway (lazy:
// connects on first command). Without DATABASE_URL the routes fail closed.
import { buildApp } from './app.js'
import { createDbPool, serverPoolBudget } from './db/index.js'
import { createLogger } from './observability/logging.js'
import { ensureTemporalTracing } from './observability/temporal-tracing.js'
import { ensureTracing, wrapPool } from './observability/tracing.js'
import { TemporalRunsGateway } from './temporal/runs-gateway.js'

const port = Number(process.env['PORT'] ?? 3001)
const connectionString = process.env['DATABASE_URL']
const logger = createLogger({ op: 'http' })
// Spans export as JSONL through the app logger (B5.2 staging path).
ensureTracing({ logger })
// OTel context manager + propagator for the Temporal interceptors (P3.2).
ensureTemporalTracing()
const pool = connectionString ? wrapPool(createDbPool(connectionString, serverPoolBudget())) : undefined
const app = buildApp({
  pool,
  runs: pool ? new TemporalRunsGateway(pool) : undefined,
  auth: true,
  logger,
})
await app.listen({ port, host: '0.0.0.0' })
