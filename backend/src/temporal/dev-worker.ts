import * as fileProcessingActivities from './activities/file-processing.js'
// Dev worker entry: serves the turn lane (session chat plus subagent
// delegation) and the sweep lane (sector discovery) locally. Session
// workflows (workflows/run.ts) call only the turn activities, so that
// worker registers exactly appendEventActivity + karbotTurnActivity —
// never the retired scripted scaffolding. The delegation parent and leaf
// children ride the same turn lane (shared capacity, retune at fleet
// scale): one Worker serves one bundle, so the turn worker loads the
// turn-bundle aggregator (run.js plus subagents.js) instead of run.js
// alone. The sweep worker registers the sector-sweep activities and the
// sectorSweep workflow. Any production fleet is out of scope;
// see docs/environments.md.
//
// Run: npm run worker --workspace @kardata/backend (needs DATABASE_URL,
// TEMPORAL_ADDRESS, provider keys, KARDATA_MCP_URL/TOKEN, and
// KARDATA_WEB_SEARCH_KEY for live sweeps in env).
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Runtime } from '@temporalio/worker'
import { createLogger, createWorkerLogger,workerLoggingOptions } from '../observability/logging.js'
import { workerTelemetryOptions } from '../observability/metrics.js'
import {
  loadSweepContextActivity,
  recordSweepCompanyActivity,
  searchWebPageActivity,
  setSweepStateActivity,
} from './activities/sweep.js'
import {
  readSectorPlanActivity,
  setPlanStateActivity,
  writePlanArtifactActivity,
} from './activities/plan.js'
import { appendEventActivity, checkWorkerMcpAuth, karbotTurnActivity } from './activities/turn.js'
import { connectWorker, temporalNamespace } from './connection.js'
import { createLaneWorker } from './worker.js'
import * as coordinatorActivities from './activities/coordinator.js'
import { reconciliationPageActivity } from './activities/reconciliation.js'
import { ensureExecutionReconciliation, ensureFileAdmissionReconciliation } from './reconciliation-start.js'
import { fileAdmissionPageActivity } from './activities/file-admission.js'
import { prepareExecutionIntentActivity,settlePreparedExecutionIntentActivity,originalRecoveryReadyActivity } from './activities/execution-epochs.js'

async function main(): Promise<void> {
  Runtime.install({ logger: createWorkerLogger(), telemetryOptions: { logging: workerLoggingOptions(),metrics: workerTelemetryOptions(Number(process.env['KARDATA_TEMPORAL_METRICS_PORT'] ?? 9464)) } })
  // Credential self-check first: a rotated-but-not-recreated token fails
  // loudly here instead of as cryptic per-turn 403s. Polling continues on
  // a negative result so digest-answerable turns keep working.
  const mcpAuth = await checkWorkerMcpAuth({})
  if (!mcpAuth.ok) console.error(`[FATAL] worker mcp auth: ${mcpAuth.reason}`)
  const connection = await connectWorker()
  const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), 'workflows')
  const turnWorker = await createLaneWorker({
    lane: 'turn',
    connection,
    namespace: temporalNamespace(),
    workflowsPath: join(workflowsDir, 'turn-bundle.js'),
    activities: { appendEventActivity, karbotTurnActivity,prepareExecutionIntentActivity,settlePreparedExecutionIntentActivity,originalRecoveryReadyActivity },
  })
  const sweepWorker = await createLaneWorker({
    lane: 'research',
    connection,
    namespace: temporalNamespace(),
    workflowsPath: join(workflowsDir, 'research-bundle.js'),
    activities: {
      ...coordinatorActivities,
      prepareFileProcessingActivity: fileProcessingActivities.prepareFileProcessingActivity,
      nextFileImageActivity: fileProcessingActivities.nextFileImageActivity,
      processFileImageActivity: fileProcessingActivities.processFileImageActivity,
      finalizeFileProcessingActivity: fileProcessingActivities.finalizeFileProcessingActivity,
      failFileProcessingActivity: fileProcessingActivities.failFileProcessingActivity,
      reconciliationPageActivity,
      fileAdmissionPageActivity,
      prepareExecutionIntentActivity,
      settlePreparedExecutionIntentActivity,
      loadSweepContextActivity,
      searchWebPageActivity,
      recordSweepCompanyActivity,
      setSweepStateActivity,
      readSectorPlanActivity,
      setPlanStateActivity,
      writePlanArtifactActivity,
    },
  })
  const shutdown = (): void => {
    void turnWorker.shutdown()
    void sweepWorker.shutdown()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  console.log(`turn worker polling ${turnWorker.options.taskQueue}`)
  console.log(`sweep worker polling ${sweepWorker.options.taskQueue}`)
  try {
    await ensureExecutionReconciliation()
    await ensureFileAdmissionReconciliation()
    await Promise.all([turnWorker.run(), sweepWorker.run()])
  } finally { await connection.close() }
}

void main().catch((error: unknown) => {
  createLogger({ op: 'worker.startup' }).error({ error }, 'Worker startup failed')
  process.exitCode = 1
})
