// DB access layer barrel (B7.1). The ONLY import surface for database
// access: product code imports from '../db/index.js' (or './index.js'),
// never deep into repos and never 'pg' directly (enforced by eslint
// no-restricted-imports). Repositories land here slice by slice.
export * from './workspace.js'
export * from './workspace-global-context.js'
export * from './workspace-threads.js'
export * from './workspace-library.js'
export * from './workspace-research.js'
export * from './reconciliation.js'
export { listSupervisionAlerts, raiseAlert, resolveAlert } from './alerts.js'
export * from './file-jobs.js'
export * from './file-processing-dispatch.js'
export * from './sessions.js'
export * from './event-artifacts.js'
export * from './execution-epochs.js'
export { DbContractError } from './errors.js'
export {
  type Db,
  type DbQueryResult,
  EventEnvelope,
  appendEvent,
  deleteEventsBySeq,
  findEventByKey,
  findLaunchParentWorkflowId,
  type ColdEventPointer,
  listColdPointers,
  readEventsAfter,
  readEventsOlderThan,
  readPartition,
  recordColdPointers,
  type StoredEvent,
} from './events.js'
export {
  createSession,
  deleteSession,
  getSession,
  getSessionModel,
  listSessions,
  renameSession,
  SessionModelSelection,
  setSessionModel,
} from './sessions.js'
export {
  createArtifact,
  listArtifacts,
  listTenantArtifacts,
  referenceArtifact,
  resolveArtifactScope,
} from './event-artifacts.js'
export {
  getThread,
  getThreadHeader,
  listThreads,
  listThreadHeaders,
  readSectorThread,
  projectBatch,
  rebuildFromEvents,
  cancelThreadRun,
  getThreadRun,
  listThreadQueue,
  listThreadRuns,
  pauseThreadRun,
  removeThreadQueueItem,
  reorderThreadQueue,
  resumeThreadRun,
  sendThreadMessage,
  steerThread,
  threadTurnBusy,
  type ThreadMessenger,
} from './threads.js'
export {
  researchHealth,
} from './research-health.js'
export {
  fleetTotals,
  projectUsage,
  rebuildLedger,
  runTotals,
} from './ledger.js'
export {
  runCheckpointTx,
  type TransactableDb,
} from './checkpoints.js'
export {
  KbDocumentInput,
  recordKbBatch,
  searchKb,
} from './knowledge.js'
export {
  getLedgerCompany,
  LedgerQualification,
  listLedgerCompanies,
  listLedgerProblems,
  recordLedgerProblem,
  RecordProblemInput,
  UpsertCompanyInput,
  upsertLedgerCompany,
  registerLedgerCandidate,
} from './company-ledger.js'
export {
  CompanyStage,
  SectorState,
  assertSectorTransition,
  SectorTransitionError,
  createSector,
  getSector,
  listCompanies,
  listSectorCompanies,
  listSectors,
  markCompanyFound,
  registerSectorDiscovery,
  readSectorExecutionState,
  recordResearchSession,
  sectorActivity,
  setCompanyStage,
  setCompanyState,
  setSectorState,
} from './sectors.js'
export {
  SECTOR_DOCUMENT_MAX_BYTES,
  ingestSectorDocument,
  listSectorDocuments,
  querySectorDocument,
  readSectorDocument,
  readOriginalSectorDocument,
} from './sector-documents.js'
export {
  countDocumentUnits,
  listDocumentUnits,
} from './document-units.js'
export {
  approveSectorPlan,
  readSectorPlan,
  recordPlanVersion,
  updateSectorPlan,
  type PlanVersion,
  type SectorPlan,
} from './sector-plan.js'
export {
  SectorStartError,
  startSectorResearch,
  type SectorSweepRunner,
} from './sector-start.js'
export {
  pauseSectorSweep,
  restartSectorSweep,
  resumeSectorSweep,
} from './sector-lifecycle.js'
export {
  claimMonitorTick,
  finishMonitor,
  getMonitor,
  listMonitors,
  releaseMonitorTick,
  startMonitor,
  stopMonitor,
  type MonitorRunner,
} from './monitors.js'
export {
  addContextNotes,
} from './sector-context.js'
export {
  classifyUpload,
  ScriptedOcrAdapter,
  type OcrAdapter,
} from './file-pipeline.js'
export {
  DEFAULT_POOL_BUDGET,
  createDbPool,
  poolStats,
  serverPoolBudget,
  validatePoolBudget,
  workerPoolBudget,
  workerPoolFromEnv,
} from './pool.js'
export { findKeyByHash, registerApiKey } from './keys.js'
export {
  checkRate,
  claimIdempotency,
  completeIdempotency,
  releaseIdempotency,
  sweepIdempotency,
} from './quotas.js'
export {
  listHeartbeats,
  pruneHeartbeats,
  recordHeartbeat,
} from './heartbeats.js'
export {
  type ConnectableDb,
  latestOutboxSeq,
  type OutboxRow,
  pruneOutbox,
  publishOutboxFrame,
  readOutboxBacklog,
  subscribeOutbox,
} from './outbox.js'

export { recordTurnExecution, listThreadExecutionRecords, readThreadExecutionReference, readRecoveryRequestReference } from './execution-records.js'
export { workspaceReferenceSnapshot } from './workspace-research.js'

export {readSectorDocumentUnitsPage} from './sector-documents.js'
export { readSectorEvaluation, readSectorCost, readThreadCost, type SectorCost, type SectorEvaluation, type SectorQuality, type KindReliability } from './evaluation.js'
export { acquireMetaPermit, ensureMetaPermits, withMetaPermit, resolveMetaMax, MetaPermitTimeout } from './meta-limiter.js'
