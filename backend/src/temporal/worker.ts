// Lane worker factory. B2.1. One Worker per lane from laneConfig; tests
// override the task queue for isolation. Shutdown is graceful: the worker
// stops polling and running activities receive WORKER_SHUTDOWN cancellation.
import { NativeConnection, Worker } from '@temporalio/worker'
import { laneConfig, type Lane } from './lanes.js'

// Local structural type: the SDK types worker activities as plain `object`.
export type ActivityFunction = (...args: never[]) => unknown

export interface LaneWorkerOptions {
  lane: Lane
  connection: NativeConnection
  namespace: string
  workflowsPath: string
  activities: Record<string, ActivityFunction>
  /** Test-only isolation override; production always uses the lane queue. */
  taskQueue?: string
}

export async function createLaneWorker(options: LaneWorkerOptions): Promise<Worker> {
  const config = laneConfig(options.lane)
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue ?? config.taskQueue,
    workflowsPath: options.workflowsPath,
    activities: options.activities,
    maxConcurrentWorkflowTaskExecutions: config.maxConcurrentWorkflowTaskExecutions,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivityTaskExecutions,
  })
}
