import { continueAsNew, log, proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities/reconciliation.js'

const supervision = proxyActivities<typeof activities>({ startToCloseTimeout: '90s', scheduleToCloseTimeout: '5m', heartbeatTimeout: '15s', retry: { maximumAttempts: 3, initialInterval: '2s', maximumInterval: '10s' } })

/** Continue-as-new bounds history; the keyset cursor survives worker death
 * and each activity retry replays idempotent decisions. One singleton per
 * namespace, on the existing research queue; no additional service. */
export async function executionReconciliation(input: { cursor?: string } = {}): Promise<never> {
  let cursor = input.cursor ?? ''
  for (let pages = 0; pages < 100; pages += 1) {
    try {
      const result = await supervision.reconciliationPageActivity(cursor)
      cursor = result.cursor
      if (result.deferred) log.warn('execution.reconciliation.page_deferred',{ cursor,code: result.deferred })
    } catch {
      // Exhausted per-page retries park this scan, not the campaign or the
      // durable supervisor. Retry the same cursor on the next bounded pass.
      log.warn('execution.reconciliation.page_failed', { cursor, code: 'reconciliation_unavailable' })
    }
    await sleep('30s')
  }
  return continueAsNew<typeof executionReconciliation>({ cursor })
}
