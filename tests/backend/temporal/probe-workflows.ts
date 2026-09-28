// Probe workflows for lane tests. Workflow code only: imports from
// @temporalio/workflow exclusively so the bundler stays deterministic.
// Activities run on the workflow's own task queue (no explicit taskQueue),
// which lets one workflow file serve every isolated test queue.
import { proxyActivities } from '@temporalio/workflow'

interface ProbeActivities {
  rendezvous(): Promise<string>
  quick(): Promise<string>
}

const activities = proxyActivities<ProbeActivities>({
  startToCloseTimeout: '60s',
  heartbeatTimeout: '3s',
  retry: { maximumAttempts: 10, initialInterval: '500ms' },
})

export async function blockingWorkflow(): Promise<string> {
  return activities.rendezvous()
}

export async function quickWorkflow(): Promise<string> {
  return activities.quick()
}
