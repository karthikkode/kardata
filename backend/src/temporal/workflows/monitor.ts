import { continueAsNew, defineSignal, log, proxyActivities, setHandler, sleep } from '@temporalio/workflow'
import type * as activities from '../activities/monitor.js'

const monitor = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
  retry: { maximumAttempts: 3, initialInterval: '5s', maximumInterval: '30s' },
})

export const monitorStopSignal = defineSignal('monitorStop')

/** Karbot monitor: sleep everyMs, fire one tick activity, stop at
 * untilMs or on monitorStop. A failed tick logs and continues on the
 * next interval; history stays bounded via continue-as-new. */
export async function karbotMonitor(input: { monitorId: string; everyMs: number; untilMs: number; maxTicks?: number }): Promise<string> {
  let stopped = false
  setHandler(monitorStopSignal, () => { stopped = true; log.info('signal received', { signal: 'monitorStop' }) })
  for (let tick = 0; tick < (input.maxTicks ?? 100); tick++) {
    if (stopped) return 'stopped'
    if (Date.now() >= input.untilMs) {
      await monitor.finishMonitorActivity({ monitorId: input.monitorId })
      return 'until'
    }
    await sleep(Math.max(1, Math.min(input.everyMs, input.untilMs - Date.now())))
    if (stopped) return 'stopped'
    try {
      const result = await monitor.monitorTickActivity({ monitorId: input.monitorId })
      // The row is the durable stop signal: a run orphaned across CAN
      // (signal lost) exits on its first stopped skip instead of ticking
      // dead until untilMs.
      if (result.skipped === 'stopped') return 'stopped'
    } catch {
      log.warn('monitor.tick_failed', { monitorId: input.monitorId })
    }
  }
  // A stop landing between the last check and CAN belongs to this run:
  // without this the fresh execution starts unstopped and ticks on.
  if (stopped) return 'stopped'
  return continueAsNew<typeof karbotMonitor>(input)
}
