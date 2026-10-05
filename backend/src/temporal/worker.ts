// Lane worker factory. B2.1. One Worker per lane from laneConfig; tests
// override the task queue for isolation. Shutdown is graceful: the worker
// stops polling and running activities receive WORKER_SHUTDOWN cancellation.
import { NativeConnection, Worker, type WorkerOptions } from '@temporalio/worker'
import type { Logger } from 'pino'
import { createLogger } from '../observability/logging.js'
import {
  temporalActivityInterceptorFactories,
  temporalWorkflowExportSinks,
  temporalWorkflowModules,
} from '../observability/temporal-tracing.js'
import { laneConfig, type Lane } from './lanes.js'

// Local structural type: the SDK types worker activities as plain `object`.
type ActivityFunction = (...args: never[]) => unknown

export interface LaneWorkerOptions {
  lane: Lane
  connection: NativeConnection
  namespace: string
  workflowsPath: string
  activities: Record<string, ActivityFunction>
  /** Test-only isolation override; production always uses the lane queue. */
  taskQueue?: string
  /** Span sink for workflow-execution spans; defaults to stdout JSON. */
  logger?: Logger
  /** Extra injected sinks, merged over the OTel exporter sink. */
  sinks?: WorkerOptions['sinks']
}

export async function createLaneWorker(options: LaneWorkerOptions): Promise<Worker> {
  const config = laneConfig(options.lane)
  const logger = options.logger ?? createLogger({ op: 'temporal.worker' })
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue ?? config.taskQueue,
    workflowsPath: options.workflowsPath,
    activities: options.activities,
    interceptors: {
      activity: temporalActivityInterceptorFactories(),
      workflowModules: temporalWorkflowModules(),
    },
    sinks: { ...temporalWorkflowExportSinks(logger, 'kardata-worker'), ...options.sinks },
    maxConcurrentWorkflowTaskExecutions: config.maxConcurrentWorkflowTaskExecutions,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivityTaskExecutions,
  })
}
